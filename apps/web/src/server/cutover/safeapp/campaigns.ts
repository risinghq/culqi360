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
import type { ActivityChannel } from "~/server/platform/database/types";

import {
  day,
  limaMidnight,
  limaTime,
  sourceId,
  text,
  type SkippedRow,
  type Warnings,
} from "./rows";
import type { SafeappSnapshot, SourceRow } from "./source";

export type CutoverCampaign = { id: CampaignId; name: string };

export type CutoverCampaignRecord = {
  id: CampaignRecordId;
  campaignId: CampaignId;
  organizationId: OrganizationId;
  segment: string;
  facts: Record<string, string>;
  workedAt: Date | null;
};

export type CutoverCampaignHold = {
  recordId: CampaignRecordId;
  userId: UserId;
  heldAt: Date;
  releasedAt: Date | null;
};

export type CutoverOutcome = OutcomeSeed & { id: ActivityOutcomeId };

export type CutoverActivity = {
  id: ActivityId;
  channel: ActivityChannel;
  userId: UserId;
  branchId: BranchId;
  organizationId: OrganizationId;
  campaignRecordId: CampaignRecordId | null;
  phone: string | null;
  startedAt: Date;
  outcomeId: ActivityOutcomeId | null;
  notes: string | null;
};

export type CampaignPlan = {
  campaigns: CutoverCampaign[];
  campaignRecords: CutoverCampaignRecord[];
  campaignHolds: CutoverCampaignHold[];
  outcomes: CutoverOutcome[];
  activities: CutoverActivity[];
};

export type CampaignPlanInput = {
  snapshot: SafeappSnapshot;
  newId: () => string;
  at: Date;
  users: ReadonlyMap<string, { id: UserId; branchId: BranchId }>;
  organizations: ReadonlyMap<string, OrganizationId>;
  skipped: SkippedRow[];
  warnings: Warnings;
};

// The columns of a dato the import file supplied. They become the record's
// facts.
const FACT_COLUMNS = [
  "zonal",
  "nodo",
  "q_movistar",
  "q_entel",
  "q_claro",
  "q_bitel",
] as const;

function byNumericId(column: string) {
  return (a: SourceRow, b: SourceRow) =>
    Number(sourceId(a[column]) ?? 0) - Number(sourceId(b[column]) ?? 0);
}

function later(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

// safeapp marks a dato worked without a date, so its latest call dates it.
function lastCallByDato(llamada: readonly SourceRow[]): Map<string, Date> {
  const last = new Map<string, Date>();
  for (const row of llamada) {
    const dato = sourceId(row.id_dato);
    const at = limaTime(row.fecha);
    if (dato && at) {
      const previous = last.get(dato);
      last.set(dato, previous ? later(previous, at) : at);
    }
  }
  return last;
}

function factsOf(row: SourceRow): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const column of FACT_COLUMNS) {
    const value = text(row[column]);
    if (value !== null) {
      facts[column] = value;
    }
  }
  return facts;
}

// A dato's tipo_data (MOVIL, FIJA) is the line of business an agent works, so
// it names the campaign. Its origen is the list the dato came from, the segment
// an agent draws from.
function planRecords(input: CampaignPlanInput): {
  campaigns: Map<string, CutoverCampaign>;
  records: Map<string, CutoverCampaignRecord>;
  recordOfDato: Map<string, CutoverCampaignRecord>;
} {
  const lastCall = lastCallByDato(input.snapshot.llamada);
  const campaigns = new Map<string, CutoverCampaign>();
  const records = new Map<string, CutoverCampaignRecord>();
  const recordOfDato = new Map<string, CutoverCampaignRecord>();
  for (const row of input.snapshot.datos.toSorted(byNumericId("id_dato"))) {
    const id = sourceId(row.id_dato);
    if (!id) {
      continue;
    }
    const name = text(row.tipo_data);
    const segment = text(row.origen);
    const organizationId = input.organizations.get(
      sourceId(row.id_cliente) ?? "",
    );
    if (!name || !segment || !organizationId) {
      input.skipped.push({
        table: "datos",
        sourceId: id,
        reason: !name
          ? "campaign_missing"
          : !segment
            ? "segment_missing"
            : "organization_missing",
      });
      continue;
    }
    const campaign = campaigns.get(name) ?? {
      id: CampaignId.trust(input.newId()),
      name,
    };
    campaigns.set(name, campaign);
    const workedAt =
      text(row.estado) === "1" ? (lastCall.get(id) ?? input.at) : null;

    // Two clientes with one RUC map to one organization, so their datos may
    // meet on one record.
    const key = JSON.stringify([campaign.id, organizationId, segment]);
    const existing = records.get(key);
    if (existing) {
      input.warnings.add("datos: merged with a dato of the same RUC");
      existing.workedAt ??= workedAt;
      recordOfDato.set(id, existing);
      continue;
    }
    const record: CutoverCampaignRecord = {
      id: CampaignRecordId.trust(input.newId()),
      campaignId: campaign.id,
      organizationId,
      segment,
      facts: factsOf(row),
      workedAt,
    };
    records.set(key, record);
    recordOfDato.set(id, record);
  }
  return { campaigns, records, recordOfDato };
}

// work360 allows one open holder per record. When safeapp left two open, the
// later hold keeps the record and the earlier closes when the later began.
function planHolds(
  input: CampaignPlanInput,
  recordOfDato: ReadonlyMap<string, CutoverCampaignRecord>,
): CutoverCampaignHold[] {
  const holds: CutoverCampaignHold[] = [];
  const openOf = new Map<CampaignRecordId, CutoverCampaignHold>();
  for (const row of input.snapshot.asignacion_datos.toSorted(
    byNumericId("id_asignacion"),
  )) {
    const id = sourceId(row.id_asignacion) ?? "?";
    const record = recordOfDato.get(sourceId(row.id_dato) ?? "");
    const user = input.users.get(sourceId(row.id_usuario) ?? "");
    if (!record || !user) {
      input.skipped.push({
        table: "asignacion_datos",
        sourceId: id,
        reason: record ? "user_missing" : "record_missing",
      });
      continue;
    }
    const assigned = day(row.fecha_asignacion);
    const heldAt = assigned ? limaMidnight(assigned) : input.at;
    const open = text(row.activa) === "1";
    const released = day(row.fecha_liberacion);
    const hold: CutoverCampaignHold = {
      recordId: record.id,
      userId: user.id,
      heldAt,
      releasedAt: open
        ? null
        : later(released ? limaMidnight(released) : heldAt, heldAt),
    };
    if (open) {
      const previous = openOf.get(record.id);
      if (previous) {
        input.warnings.add("asignacion_datos: record held twice");
        previous.releasedAt = later(heldAt, previous.heldAt);
      }
      openOf.set(record.id, hold);
    }
    holds.push(hold);
  }
  return holds;
}

// The call log has no columns for the contact's name and email, so they lead
// the notes.
function callNotes(row: SourceRow): string | null {
  const name = text(row.nombre_contacto);
  const email = text(row.correo);
  const contact =
    name && email ? `${name} (${email})` : (name ?? email ?? null);
  const lines = [
    contact ? `Contacto: ${contact}` : null,
    text(row.comentario),
  ].filter((line) => line !== null);
  return lines.length > 0 ? lines.join("\n") : null;
}

// safeapp stores its flags as MySQL booleans; anything else leaves the flag
// unstated.
function flag(value: string | null | undefined): boolean | null {
  const raw = text(value);
  return raw === "1" ? true : raw === "0" ? false : null;
}

// A respuesta becomes an outcome of its tipo's channel. Two respuestas with one
// label on one channel share an outcome, because live labels are unique.
function planOutcomes(input: CampaignPlanInput): {
  outcomes: CutoverOutcome[];
  outcomeOfRespuesta: Map<string, CutoverOutcome>;
} {
  const outcomes: CutoverOutcome[] = [];
  const byLabel = new Map<string, CutoverOutcome>();
  const outcomeOfRespuesta = new Map<string, CutoverOutcome>();
  for (const row of input.snapshot.respuesta.toSorted(
    byNumericId("id_respuesta"),
  )) {
    const id = sourceId(row.id_respuesta);
    const label = text(row.descripcion);
    if (!id || !label) {
      input.warnings.add("respuesta: missing id or descripcion");
      continue;
    }
    const tipo = text(row.tipo);
    if (tipo !== "LLAMADA" && tipo !== "VISITA") {
      input.warnings.add("respuesta.tipo: unknown tipo, read as LLAMADA");
    }
    const channel: ActivityChannel = tipo === "VISITA" ? "visit" : "call";
    const key = `${channel}\u0000${label}`;
    let outcome = byLabel.get(key);
    if (outcome) {
      input.warnings.add("respuesta.descripcion: repeated label");
    } else {
      outcome = {
        id: ActivityOutcomeId.trust(input.newId()),
        label,
        channel,
        contacted: flag(row.contactabilidad),
        negotiated: flag(row.negociacion),
        callback: flag(row.volverllamar),
      };
      byLabel.set(key, outcome);
      outcomes.push(outcome);
    }
    outcomeOfRespuesta.set(id, outcome);
  }
  return { outcomes, outcomeOfRespuesta };
}

// A llamada with a VISITA respuesta was a visit, so it becomes one.
function planActivities(
  input: CampaignPlanInput,
  recordOfDato: ReadonlyMap<string, CutoverCampaignRecord>,
  outcomeOfRespuesta: ReadonlyMap<string, CutoverOutcome>,
): CutoverActivity[] {
  const activities: CutoverActivity[] = [];
  for (const row of input.snapshot.llamada.toSorted(
    byNumericId("id_llamada"),
  )) {
    const id = sourceId(row.id_llamada) ?? "?";
    const user = input.users.get(sourceId(row.id_usuario) ?? "");
    const organizationId = input.organizations.get(
      sourceId(row.id_cliente) ?? "",
    );
    const startedAt = limaTime(row.fecha);
    if (!user || !organizationId || !startedAt) {
      input.skipped.push({
        table: "llamada",
        sourceId: id,
        reason: !user
          ? "user_missing"
          : !organizationId
            ? "organization_missing"
            : "date_missing",
      });
      continue;
    }
    const dato = sourceId(row.id_dato);
    const found = dato ? recordOfDato.get(dato) : undefined;
    if (dato && !found) {
      input.warnings.add("llamada.id_dato: unknown dato");
    }
    // A call keeps its own cliente's company, so it drops a record of another.
    const record = found?.organizationId === organizationId ? found : undefined;
    if (found && !record) {
      input.warnings.add("llamada.id_dato: dato of another cliente");
    }
    const outcome = outcomeOfRespuesta.get(sourceId(row.id_respuesta) ?? "");
    if (outcome === undefined) {
      input.warnings.add("llamada.id_respuesta: unknown respuesta");
    }
    const channel = outcome?.channel ?? "call";
    activities.push({
      id: ActivityId.trust(input.newId()),
      channel,
      userId: user.id,
      branchId: user.branchId,
      organizationId,
      campaignRecordId: record?.id ?? null,
      phone: channel === "call" ? text(row.telefono) : null,
      startedAt,
      outcomeId: outcome?.id ?? null,
      notes: callNotes(row),
    });
  }
  return activities;
}

// Maps safeapp's datos, asignacion_datos, respuesta and llamada onto
// campaigns, outcomes and activities.
export function planCampaigns(input: CampaignPlanInput): CampaignPlan {
  const { campaigns, records, recordOfDato } = planRecords(input);
  const { outcomes, outcomeOfRespuesta } = planOutcomes(input);
  return {
    campaigns: [...campaigns.values()],
    campaignRecords: [...records.values()],
    campaignHolds: planHolds(input, recordOfDato),
    outcomes,
    activities: planActivities(input, recordOfDato, outcomeOfRespuesta),
  };
}
