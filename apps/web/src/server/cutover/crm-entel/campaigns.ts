import {
  ActivityId,
  ActivityOutcomeId,
  CampaignId,
  CampaignRecordId,
  type BranchId,
  type OrganizationId,
  type UserId,
} from "~/domain/ids";
import type { OutcomeSeed } from "~/server/activities/domain/outcome-seed";

import type {
  CutoverActivity,
  CutoverCampaign,
  CutoverCampaignHold,
  CutoverCampaignRecord,
  CutoverOutcome,
} from "../shared/plan";
import type { SourceRow } from "../shared/postgres";
import {
  later,
  sourceId,
  text,
  utcTime,
  type SkippedRow,
  type Warnings,
} from "../shared/rows";
import type { CrmEntelSnapshot } from "./source";

export type CampaignInput = {
  snapshot: CrmEntelSnapshot;
  newId: () => string;
  at: Date;
  users: ReadonlyMap<string, { id: UserId; branchId: BranchId }>;
  organizations: ReadonlyMap<string, OrganizationId>;
  skipped: SkippedRow[];
  warnings: Warnings;
};

const CAMPAIGN_OF: Readonly<Record<string, string>> = {
  MOVIL: "Móvil",
  FIJA: "Fija",
};

// The lines a company holds per operator, as the base upload counted them.
const LINE_FACTS = [
  ["lineas_entel", "q_entel"],
  ["lineas_claro", "q_claro"],
  ["lineas_movistar", "q_movistar"],
  ["lineas_bitel", "q_bitel"],
  ["lineas_flash", "q_flash"],
  ["lineas_guinea", "q_guinea"],
] as const;

const OUTCOMES: Readonly<Record<string, OutcomeSeed>> = {
  NO_CONTESTA: {
    label: "No contesta",
    channel: "call",
    contacted: false,
    negotiated: false,
    callback: false,
  },
  NOS_RECHAZO: {
    label: "Nos rechazó",
    channel: "call",
    contacted: true,
    negotiated: false,
    callback: false,
  },
  DESEA_MOVIL: {
    label: "Desea móvil",
    channel: "call",
    contacted: true,
    negotiated: true,
    callback: false,
  },
  DESEA_FIJA: {
    label: "Desea fija",
    channel: "call",
    contacted: true,
    negotiated: true,
    callback: false,
  },
};

// Outcomes CRM Entel never recorded that a work360 workspace starts with.
const EXTRA_OUTCOMES: readonly OutcomeSeed[] = [
  {
    label: "Volver a llamar",
    channel: "call",
    contacted: true,
    negotiated: false,
    callback: true,
  },
  {
    label: "Visita realizada",
    channel: "visit",
    contacted: true,
    negotiated: null,
    callback: null,
  },
];

function factsOf(row: SourceRow | undefined): Record<string, string> {
  const facts: Record<string, string> = {};
  const tipo = text(row?.tipo);
  if (tipo) {
    facts.tipo = tipo;
  }
  for (const [column, fact] of LINE_FACTS) {
    const value = text(row?.[column]);
    if (value && value !== "0") {
      facts[fact] = value;
    }
  }
  return facts;
}

function lastGestionByCliente(
  gestiones: readonly SourceRow[],
): Map<string, Date> {
  const last = new Map<string, Date>();
  for (const row of gestiones) {
    const cliente = sourceId(row.cliente_id);
    const at = utcTime(row.created_at);
    if (cliente && at) {
      const previous = last.get(cliente);
      last.set(cliente, previous ? later(previous, at) : at);
    }
  }
  return last;
}

type RecordPlan = {
  campaigns: Map<string, CutoverCampaign>;
  records: CutoverCampaignRecord[];
  // Keyed by base id and cliente id.
  recordOf: Map<string, CutoverCampaignRecord>;
  // A cliente's records, newest base first.
  recordsOfCliente: Map<string, CutoverCampaignRecord[]>;
};

const pair = (base: string, cliente: string) => `${base}:${cliente}`;

// A base is an uploaded list. Its tipo (MOVIL, FIJA) names the campaign and
// its name is the segment an executive draws from. A deleted base's rows stay
// behind.
function planRecords(input: CampaignInput): RecordPlan {
  const clientes = new Map(
    input.snapshot.clientes.map((row) => [sourceId(row.id) ?? "", row]),
  );
  const bases = new Map(
    input.snapshot.bases.map((row) => [sourceId(row.id) ?? "", row]),
  );
  const lastGestion = lastGestionByCliente(input.snapshot.gestiones);
  const campaigns = new Map<string, CutoverCampaign>();
  const records: CutoverCampaignRecord[] = [];
  const recordOf = new Map<string, CutoverCampaignRecord>();
  const byOrganization = new Map<string, CutoverCampaignRecord>();
  const recordsOfCliente = new Map<string, CutoverCampaignRecord[]>();
  const newestFirst = input.snapshot.base_clientes.toSorted(
    (a, b) => Number(b.base_id) - Number(a.base_id),
  );
  for (const row of newestFirst) {
    const baseId = sourceId(row.base_id) ?? "";
    const clienteId = sourceId(row.cliente_id) ?? "";
    const base = bases.get(baseId);
    const name = CAMPAIGN_OF[text(base?.tipo) ?? ""];
    const segment = text(base?.nombre);
    const organizationId = input.organizations.get(clienteId);
    const reason =
      text(base?.eliminada) === "true"
        ? "base_deleted"
        : !name || !segment
          ? "base_unknown"
          : !organizationId
            ? "organization_missing"
            : null;
    if (reason || !name || !segment || !organizationId) {
      input.skipped.push({
        table: "base_clientes",
        sourceId: pair(baseId, clienteId),
        reason: reason ?? "base_unknown",
      });
      continue;
    }
    const campaign = campaigns.get(name) ?? {
      id: CampaignId.trust(input.newId()),
      name,
    };
    campaigns.set(name, campaign);
    const key = JSON.stringify([campaign.id, organizationId, segment]);
    let record = byOrganization.get(key);
    if (record) {
      input.warnings.add("base_clientes: two bases of one name and RUC");
    } else {
      record = {
        id: CampaignRecordId.trust(input.newId()),
        campaignId: campaign.id,
        organizationId,
        segment,
        facts: factsOf(clientes.get(clienteId)),
        workedAt: lastGestion.get(clienteId) ?? null,
      };
      byOrganization.set(key, record);
      records.push(record);
    }
    recordOf.set(pair(baseId, clienteId), record);
    const list = recordsOfCliente.get(clienteId) ?? [];
    list.push(record);
    recordsOfCliente.set(clienteId, list);
  }
  return { campaigns, records, recordOf, recordsOfCliente };
}

// CRM Entel never releases an assignment, so every hold stays open.
function planHolds(
  input: CampaignInput,
  recordOf: ReadonlyMap<string, CutoverCampaignRecord>,
): CutoverCampaignHold[] {
  const holds = new Map<string, CutoverCampaignHold>();
  for (const row of input.snapshot.asignaciones_ejecutivo.toSorted(
    (a, b) => Number(a.id) - Number(b.id),
  )) {
    const id = sourceId(row.id) ?? "?";
    const record = recordOf.get(
      pair(sourceId(row.base_id) ?? "", sourceId(row.cliente_id) ?? ""),
    );
    const user = input.users.get(sourceId(row.ejecutivo_id) ?? "");
    if (!record || !user) {
      input.skipped.push({
        table: "asignaciones_ejecutivo",
        sourceId: id,
        reason: record ? "user_missing" : "record_missing",
      });
      continue;
    }
    if (holds.has(record.id)) {
      input.warnings.add("asignaciones_ejecutivo: record held twice");
    }
    holds.set(record.id, {
      recordId: record.id,
      userId: user.id,
      heldAt: utcTime(row.created_at) ?? input.at,
      releasedAt: null,
    });
  }
  return [...holds.values()];
}

function planOutcomes(newId: () => string): {
  outcomes: CutoverOutcome[];
  outcomeOf: Map<string, CutoverOutcome>;
} {
  const outcomeOf = new Map<string, CutoverOutcome>();
  for (const [respuesta, seed] of Object.entries(OUTCOMES)) {
    outcomeOf.set(respuesta, { ...seed, id: ActivityOutcomeId.trust(newId()) });
  }
  const extra = EXTRA_OUTCOMES.map((seed) =>
    Object.assign({ id: ActivityOutcomeId.trust(newId()) }, seed),
  );
  return { outcomes: [...outcomeOf.values(), ...extra], outcomeOf };
}

const OPERATORS = [
  ["lineas_claro", "Claro"],
  ["lineas_movistar", "Movistar"],
  ["lineas_bitel", "Bitel"],
] as const;

// The call log keeps the contact, the lines the company holds and the
// executive's comment; work360's activity has notes for them.
function gestionNotes(row: SourceRow): string | null {
  const name = text(row.contacto_nombre);
  const email = text(row.correo);
  const contact =
    name && email ? `${name} (${email})` : (name ?? email ?? null);
  const lines = OPERATORS.flatMap(([column, label]) => {
    const value = text(row[column]);
    return value && value !== "0" ? [`${label} ${value}`] : [];
  });
  const wanted = text(row.q_lineas);
  const notes = [
    contact ? `Contacto: ${contact}` : null,
    lines.length > 0 ? `Líneas actuales: ${lines.join(", ")}` : null,
    wanted && wanted !== "0" ? `Líneas solicitadas: ${wanted}` : null,
    text(row.comentario),
  ].filter((line) => line !== null);
  return notes.length > 0 ? notes.join("\n") : null;
}

function planActivities(
  input: CampaignInput,
  records: RecordPlan,
  holds: readonly CutoverCampaignHold[],
  outcomeOf: ReadonlyMap<string, CutoverOutcome>,
): CutoverActivity[] {
  const holderOf = new Map(holds.map((hold) => [hold.recordId, hold.userId]));
  const activities: CutoverActivity[] = [];
  for (const row of input.snapshot.gestiones.toSorted(
    (a, b) => Number(a.id) - Number(b.id),
  )) {
    const id = sourceId(row.id) ?? "?";
    const clienteId = sourceId(row.cliente_id) ?? "";
    const user = input.users.get(sourceId(row.ejecutivo_id) ?? "");
    const organizationId = input.organizations.get(clienteId);
    const startedAt = utcTime(row.created_at);
    if (!user || !organizationId || !startedAt) {
      input.skipped.push({
        table: "gestiones",
        sourceId: id,
        reason: !user
          ? "user_missing"
          : !organizationId
            ? "organization_missing"
            : "date_missing",
      });
      continue;
    }
    // The record the executive held, else the company's newest base.
    const candidates = records.recordsOfCliente.get(clienteId) ?? [];
    const record =
      candidates.find((each) => holderOf.get(each.id) === user.id) ??
      candidates[0];
    const respuesta = text(row.respuesta) ?? "";
    const outcome = outcomeOf.get(respuesta);
    if (!outcome) {
      input.warnings.add("gestiones.respuesta: unknown respuesta");
    }
    activities.push({
      id: ActivityId.trust(input.newId()),
      channel: "call",
      userId: user.id,
      branchId: user.branchId,
      organizationId,
      campaignRecordId: record?.id ?? null,
      phone: text(row.telefono),
      startedAt,
      outcomeId: outcome?.id ?? null,
      notes: gestionNotes(row),
    });
  }
  return activities;
}

// Maps bases, assignments and gestiones onto campaigns, holds, outcomes and
// call activities.
export function planCampaigns(input: CampaignInput) {
  const records = planRecords(input);
  const campaignHolds = planHolds(input, records.recordOf);
  const { outcomes, outcomeOf } = planOutcomes(input.newId);
  return {
    campaigns: [...records.campaigns.values()],
    campaignRecords: records.records,
    campaignHolds,
    outcomes,
    activities: planActivities(input, records, campaignHolds, outcomeOf),
  };
}
