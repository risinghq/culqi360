import type { CaseValue } from "~/domain/cases/field-rules";
import { CaseId, type OrganizationId } from "~/domain/ids";

import type { ImportedStage } from "../../cases/infrastructure/cases-repo";
import type { CutoverPlan, CutoverUser } from "../shared/plan";
import type { SourceRow } from "../shared/postgres";
import {
  amount,
  day,
  later,
  sourceId,
  text,
  utcTime,
  Warnings,
  type SkippedRow,
} from "../shared/rows";
import { planCampaigns } from "./campaigns";
import { FIXED_SALE, MOBILE_SALE } from "./case-types";
import { planOrganizations, planPeople } from "./people";
import type { CrmEntelSnapshot } from "./source";

type PlannedCase = CutoverPlan["cases"][number];

type SaleContext = {
  users: ReadonlyMap<string, CutoverUser>;
  organizations: ReadonlyMap<string, { id: OrganizationId }>;
  newId: () => string;
  skipped: SkippedRow[];
  warnings: Warnings;
};

type Values = Record<string, CaseValue>;

function linesBySale(rows: readonly SourceRow[]): Map<string, SourceRow[]> {
  const bySale = new Map<string, SourceRow[]>();
  for (const row of rows) {
    const sale = sourceId(row.venta_id);
    if (sale) {
      const list = bySale.get(sale) ?? [];
      list.push(row);
      bySale.set(sale, list);
    }
  }
  return bySale;
}

function distinctPlans(lines: readonly SourceRow[]): string | null {
  const plans = [
    ...new Set(lines.map((line) => text(line.plan)).filter((p) => p !== null)),
  ];
  return plans.length > 0 ? plans.join(", ") : null;
}

// "CLARO 3, MOVISTAR 1": where the ported lines came from.
function operators(lines: readonly SourceRow[]): string | null {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const operator = text(line.operadora_origen);
    if (text(line.modalidad_linea) === "PORTABILIDAD" && operator) {
      counts.set(operator, (counts.get(operator) ?? 0) + 1);
    }
  }
  const parts = [...counts]
    .toSorted((a, b) => b[1] - a[1])
    .map(([operator, count]) => `${operator} ${count}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function withValues(entries: Record<string, CaseValue>): Values {
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== null),
  );
}

// The registro and validacion stages every sale has. A sale still PENDIENTE
// was never validated, so its stage keeps the sale's own time.
function saleStages(
  row: SourceRow,
  createdAt: Date,
  context: SaleContext,
  table: string,
): ImportedStage[] {
  const owner = context.users.get(sourceId(row.ejecutivo_id) ?? "");
  const validatorId = sourceId(row.validado_por);
  const validator = validatorId ? context.users.get(validatorId) : undefined;
  if (validatorId && !validator) {
    context.warnings.add(`${table}.validado_por: unknown user`);
  }
  const validacion = text(row.validacion) ?? "PENDIENTE";
  return [
    {
      stageKey: "registro",
      status: "REGISTRADO",
      updatedBy: owner?.id ?? null,
      updatedAt: createdAt,
    },
    {
      stageKey: "validacion",
      status: validacion,
      updatedBy: validacion === "PENDIENTE" ? null : (validator?.id ?? null),
      updatedAt:
        validacion === "PENDIENTE"
          ? createdAt
          : (utcTime(row.updated_at) ?? createdAt),
    },
  ];
}

function planSale(
  row: SourceRow,
  table: string,
  context: SaleContext,
  stagesAfter: (validacion: string, createdAt: Date) => ImportedStage[],
  values: Values,
  caseTypeKey: string,
): PlannedCase | null {
  const id = sourceId(row.id) ?? "?";
  const owner = context.users.get(sourceId(row.ejecutivo_id) ?? "");
  const organization = context.organizations.get(
    sourceId(row.cliente_id) ?? "",
  );
  const createdAt = utcTime(row.created_at);
  if (!owner || !organization || !createdAt) {
    context.skipped.push({
      table,
      sourceId: id,
      reason: !owner
        ? "user_missing"
        : !organization
          ? "organization_missing"
          : "date_missing",
    });
    return null;
  }
  const stages = saleStages(row, createdAt, context, table);
  stages.push(...stagesAfter(stages[1]?.status ?? "PENDIENTE", createdAt));
  const updatedAt = stages.reduce(
    (latest, stage) => later(latest, stage.updatedAt),
    createdAt,
  );
  return {
    caseTypeKey,
    id: CaseId.trust(context.newId()),
    organizationId: organization.id,
    holderUserId: owner.id,
    values,
    createdAt,
    updatedAt,
    stages,
  };
}

// The buyer's DNI, parents, birth data, address and receiver stay behind:
// work360's sale case holds the deal, not the customer's identity papers.
function mobileValues(row: SourceRow, lines: readonly SourceRow[]): Values {
  const count = (modalidad: string) =>
    lines.filter((line) => text(line.modalidad_linea) === modalidad).length;
  return withValues({
    fecha: day(row.fecha),
    q_lineas: amount(row.q_lineas),
    cargo_fijo: amount(row.cargo_fijo),
    planes: distinctPlans(lines),
    contacto: text(row.contacto_nombre),
    telefono1: text(row.telefono1),
    tipo_producto: text(row.tipo_producto),
    entrega: text(row.modalidad),
    lineas_portabilidad: count("PORTABILIDAD"),
    lineas_alta: count("ALTA"),
    operadoras: operators(lines),
    grupo: text(row.zonal_telefonica),
    comentario: text(row.comentario),
    comentario_validacion: text(row.comentario_validacion),
    comentario_back: text(row.comentario_back),
    fecha_activacion: day(row.fecha_activacion),
    mes_cargo: text(row.mes_cargo),
    mes_ganancia: text(row.mes_ganancia),
  });
}

// Activation runs only after validation passes, and the commission only
// after activation.
function mobileStages(row: SourceRow, context: SaleContext) {
  return (validacion: string, createdAt: Date): ImportedStage[] => {
    if (validacion !== "PROCEDE") {
      return [];
    }
    const back = text(row.estado_operativo) ?? "PENDIENTE";
    const stages: ImportedStage[] = [
      {
        stageKey: "back",
        status: back,
        updatedBy: null,
        updatedAt:
          utcTime(row.fecha_estado) ?? utcTime(row.updated_at) ?? createdAt,
      },
    ];
    if (back !== "ACTIVADO") {
      return stages;
    }
    const status = text(row.mes_ganancia)
      ? "GANADO"
      : text(row.mes_cargo)
        ? "CARGADO"
        : "PENDIENTE";
    const at =
      status === "GANADO"
        ? utcTime(row.fecha_ganancia)
        : status === "CARGADO"
          ? utcTime(row.fecha_cargo)
          : null;
    if (status !== "PENDIENTE" && !at) {
      context.warnings.add("ventas: commission month without its date");
    }
    stages.push({
      stageKey: "comision",
      status,
      updatedBy: null,
      updatedAt: at ?? stages[0]?.updatedAt ?? createdAt,
    });
    return stages;
  };
}

function fixedValues(row: SourceRow, lines: readonly SourceRow[]): Values {
  return withValues({
    fecha: day(row.fecha),
    q_lineas: amount(row.q_lineas),
    cargo_fijo: amount(row.cargo_fijo),
    planes: distinctPlans(lines),
    contacto: text(row.contacto_nombre),
    telefono1: text(row.telefono1),
    comentario: text(row.comentario),
    comentario_validacion: text(row.comentario_validacion),
    codigo_ot: text(row.codigo_ot),
    codigo_saf: text(row.codigo_saf),
    comentario_back: text(row.comentario_back),
    fecha_instalacion: day(row.fecha_instalacion),
    fecha_activacion: day(row.fecha_activacion),
  });
}

function fixedStages(row: SourceRow) {
  return (validacion: string, createdAt: Date): ImportedStage[] =>
    validacion === "PROCEDE"
      ? [
          {
            stageKey: "back",
            status: text(row.estado) ?? "PENDIENTE",
            updatedBy: null,
            updatedAt:
              utcTime(row.fecha_estado) ?? utcTime(row.updated_at) ?? createdAt,
          },
        ]
      : [];
}

function planCases(
  snapshot: CrmEntelSnapshot,
  context: SaleContext,
): PlannedCase[] {
  const mobileLines = linesBySale(snapshot.venta_lineas);
  const fixedLines = linesBySale(snapshot.venta_fija_lineas);
  const mobile = snapshot.ventas.map((row) => {
    const lines = mobileLines.get(sourceId(row.id) ?? "") ?? [];
    return planSale(
      row,
      "ventas",
      context,
      mobileStages(row, context),
      mobileValues(row, lines),
      MOBILE_SALE.key,
    );
  });
  const fixed = snapshot.ventas_fija.map((row) => {
    const lines = fixedLines.get(sourceId(row.id) ?? "") ?? [];
    return planSale(
      row,
      "ventas_fija",
      context,
      fixedStages(row),
      fixedValues(row, lines),
      FIXED_SALE.key,
    );
  });
  return [...mobile, ...fixed].filter((each) => each !== null);
}

// A status the case type does not list would leave a case no queue shows.
function checkStatuses(cases: readonly PlannedCase[], warnings: Warnings) {
  const types = new Map([MOBILE_SALE, FIXED_SALE].map((t) => [t.key, t]));
  for (const planned of cases) {
    const type = types.get(planned.caseTypeKey);
    for (const stage of planned.stages) {
      const definition = type?.stages.find((s) => s.key === stage.stageKey);
      if (!definition?.statuses.includes(stage.status)) {
        throw new Error(
          `cutover_unknown_status:${planned.caseTypeKey}.${stage.stageKey}`,
        );
      }
    }
  }
  if (cases.length === 0) {
    warnings.add("cases: none");
  }
}

export function planCrmEntelCutover(input: {
  snapshot: CrmEntelSnapshot;
  newId: () => string;
  at: Date;
}): CutoverPlan {
  const skipped: SkippedRow[] = [];
  const warnings = new Warnings();
  const people = planPeople(input.snapshot, input.newId, skipped);
  const organizations = planOrganizations(input.snapshot, input.newId, skipped);
  const context: SaleContext = {
    users: people.users,
    organizations,
    newId: input.newId,
    skipped,
    warnings,
  };
  const cases = planCases(input.snapshot, context);
  checkStatuses(cases, warnings);
  const campaigns = planCampaigns({
    snapshot: input.snapshot,
    newId: input.newId,
    at: input.at,
    users: people.users,
    organizations: new Map(
      [...organizations].map(([source, organization]) => [
        source,
        organization.id,
      ]),
    ),
    skipped,
    warnings,
  });
  return {
    roles: [],
    branches: people.branches,
    teams: people.teams,
    users: [...people.users.values()],
    organizations: [...new Set(organizations.values())],
    caseTypes: [MOBILE_SALE, FIXED_SALE],
    cases,
    ...campaigns,
    report: { skipped, warnings: warnings.counts },
  };
}
