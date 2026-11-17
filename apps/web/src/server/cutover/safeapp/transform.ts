import type { CaseValue } from "~/domain/cases/field-rules";
import { parseRuc, type Ruc } from "~/domain/identity/document";
import { BranchId, CaseId, OrganizationId, UserId } from "~/domain/ids";
import { isErr } from "~/shared/result";

import type {
  CaseFieldDefinition,
  CaseTypeDefinition,
} from "../../cases/domain/definition";
import type {
  ImportedCase,
  ImportedStage,
} from "../../cases/infrastructure/cases-repo";
import { entelCaseTypes, type EntelCatalog } from "../../cases/presets/entel";
import { planCampaigns, type CampaignPlan } from "./campaigns";
import {
  amount,
  day,
  limaMidnight,
  sourceId,
  text,
  Warnings,
  type SkippedRow,
} from "./rows";
import type { SafeappSnapshot, SourceRow } from "./source";

export type CutoverBranch = { id: BranchId; name: string };

export type CutoverUser = {
  id: UserId;
  branchId: BranchId;
  username: string;
  email: string;
  names: string;
  firstSurname: string;
  secondSurname: string;
  // A baseline role key or one of ENTEL_ROLES.
  roleKey: string;
  isActive: boolean;
};

export type CutoverOrganization = {
  id: OrganizationId;
  ruc: Ruc;
  legalName: string | null;
};

// Counts, never values: the report is printed, and the rows hold third-party
// personal data.
export type CutoverReport = {
  skipped: SkippedRow[];
  warnings: Record<string, number>;
};

export type CutoverPlan = CampaignPlan & {
  branches: CutoverBranch[];
  users: CutoverUser[];
  organizations: CutoverOrganization[];
  caseTypes: CaseTypeDefinition[];
  cases: (ImportedCase & { caseTypeKey: string })[];
  report: CutoverReport;
};

export type CutoverInput = {
  snapshot: SafeappSnapshot;
  newId: () => string;
  // The time of the run, for rows safeapp never dated.
  at: Date;
};

// A user without a tienda still needs a branch, so the cutover adds one.
const NO_TIENDA = "Sin tienda";
const PLACEHOLDER_EMAIL_DOMAIN = "safeapp.invalid";

function splitPersonal(personal: string | null): {
  names: string;
  firstSurname: string;
  secondSurname: string;
} {
  const words = (personal ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 3) {
    return {
      names: words.slice(0, -2).join(" "),
      firstSurname: words.at(-2) ?? "",
      secondSurname: words.at(-1) ?? "",
    };
  }
  return {
    names: words[0] ?? "",
    firstSurname: words[1] ?? "",
    secondSurname: "",
  };
}

// work360 gives a user one role; safeapp grants screens. The strongest grant
// decides.
export function roleFromGrants(
  roleName: string | null,
  permisos: ReadonlySet<string>,
): string {
  const grants = [...permisos];
  if (roleName === "ADMINISTRADOR" || permisos.has("usuarios.manage")) {
    return "admin";
  }
  if (permisos.has("liquidacion.gestionar")) {
    return "sales_manager";
  }
  if (grants.some((permiso) => permiso.endsWith(".back"))) {
    return "back_office";
  }
  if (grants.some((permiso) => permiso.endsWith(".validar"))) {
    return "validador";
  }
  return "executive";
}

function fixedProductLabel(row: SourceRow): string | null {
  const subtipo = text(row.subtipo);
  const descripcion = text(row.descripcion);
  if (subtipo && descripcion) {
    return `${subtipo} - ${descripcion}`;
  }
  return subtipo ?? descripcion;
}

function sortedUnique(values: Iterable<string | null>): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    if (value !== null) {
      unique.add(value);
    }
  }
  return [...unique].toSorted((a, b) => a.localeCompare(b));
}

type StageSource = {
  stageKey: string;
  status: (row: SourceRow) => string | null;
  by: string | null;
  at: string | null;
};

type CaseSource = {
  table: "nc_movil" | "nc_fija" | "quiebre";
  caseTypeKey: string;
  idColumn: string;
  // The column a field reads when it is not the field's own key.
  columns: Readonly<Record<string, string>>;
  createdAt: string;
  stages: readonly StageSource[];
};

const registro = (at: string): StageSource => ({
  stageKey: "registro",
  status: () => "REGISTRADO",
  by: "id_usuario",
  at,
});

const validacionColumn = (column: string): StageSource => ({
  stageKey: "validacion",
  status: (row) => text(row[column]),
  by: "id_validador",
  at: "fecha_validacion",
});

const backStage: StageSource = {
  stageKey: "back",
  status: (row) => text(row.estado),
  by: "id_back",
  at: "fecha_actualizacion",
};

const CASE_SOURCES: readonly CaseSource[] = [
  {
    table: "nc_movil",
    caseTypeKey: "nc_movil",
    idColumn: "id_cargo",
    columns: {},
    createdAt: "fecha_ingreso",
    stages: [
      registro("fecha_ingreso"),
      validacionColumn("validacion"),
      backStage,
      // safeapp records no settler, only the date.
      {
        stageKey: "liquidacion",
        status: (row) =>
          day(row.fecha_liquidacion) ? "LIQUIDADO" : "PENDIENTE",
        by: null,
        at: "fecha_liquidacion",
      },
    ],
  },
  {
    table: "nc_fija",
    caseTypeKey: "nc_fija",
    idColumn: "id_cargo",
    columns: {},
    createdAt: "fecha_ingreso",
    stages: [
      registro("fecha_ingreso"),
      validacionColumn("validacion"),
      backStage,
    ],
  },
  {
    // The quiebre's `estado` is the validador's status. Its `back` and
    // `validacion` columns are legacy text the presets keep as a field.
    table: "quiebre",
    caseTypeKey: "quiebre",
    idColumn: "id_quiebre",
    columns: { zonal: "zonal_telefonica" },
    createdAt: "fecha_registro",
    stages: [registro("fecha_registro"), validacionColumn("estado")],
  },
];

type Lookups = {
  branches: ReadonlyMap<string, BranchId>;
  users: ReadonlyMap<string, UserId>;
  organizations: ReadonlyMap<string, OrganizationId>;
  carteras: ReadonlyMap<string, string>;
};

function fieldValue(
  source: CaseSource,
  field: CaseFieldDefinition,
  row: SourceRow,
  lookups: Lookups,
  warnings: Warnings,
): CaseValue {
  const raw = row[source.columns[field.key] ?? field.key];
  const where = `${source.table}.${field.key}`;
  if (source.table === "nc_movil" && field.key === "cartera") {
    const id = sourceId(row.id_cartera);
    const name = id ? lookups.carteras.get(id) : undefined;
    if (id && !name) {
      warnings.add(`${where}: unknown cartera`);
    }
    return name ?? null;
  }
  if (source.table === "nc_fija" && field.key === "producto") {
    return fixedProductLabel(row);
  }
  switch (field.kind) {
    case "branch": {
      const id = sourceId(raw);
      const branch = id ? lookups.branches.get(id) : undefined;
      if (id && !branch) {
        warnings.add(`${where}: unknown tienda`);
      }
      return branch ?? null;
    }
    case "number":
      return amount(raw);
    case "date":
      return day(raw);
    case "choice": {
      const value = text(raw);
      if (value !== null && !field.choices?.includes(value)) {
        warnings.add(`${where}: value outside the choices`);
      }
      return value;
    }
    case "text":
      return text(raw);
    // The Entel presets have no file field; the source app stores no files.
    case "file":
      return null;
  }
}

function caseFromRow(
  source: CaseSource,
  definition: CaseTypeDefinition,
  row: SourceRow,
  lookups: Lookups,
  input: CutoverInput,
  warnings: Warnings,
): { ok: true; value: ImportedCase } | { ok: false; reason: string } {
  const owner = lookups.users.get(sourceId(row.id_usuario) ?? "");
  if (!owner) {
    return { ok: false, reason: "owner_missing" };
  }
  const organization = lookups.organizations.get(
    sourceId(row.id_cliente) ?? "",
  );
  if (!organization) {
    return { ok: false, reason: "organization_missing" };
  }
  const filed = day(row[source.createdAt]);
  const createdAt = filed ? limaMidnight(filed) : input.at;

  const stages: ImportedStage[] = [];
  for (const stageSource of source.stages) {
    const stage = definition.stages.find(
      (each) => each.key === stageSource.stageKey,
    );
    const status = stageSource.status(row) ?? stage?.initialStatus;
    if (!stage || !status || !stage.statuses.includes(status)) {
      return {
        ok: false,
        reason: `unknown_status:${stageSource.stageKey}`,
      };
    }
    const authorId = stageSource.by ? sourceId(row[stageSource.by]) : null;
    const author = authorId ? lookups.users.get(authorId) : undefined;
    if (authorId && !author) {
      warnings.add(`${source.table}.${stageSource.by}: unknown user`);
    }
    const dated = stageSource.at ? day(row[stageSource.at]) : null;
    stages.push({
      stageKey: stage.key,
      status,
      updatedBy: author ?? null,
      updatedAt: dated ? limaMidnight(dated) : createdAt,
    });
  }

  const values: Record<string, CaseValue> = {};
  for (const field of definition.fields) {
    const value = fieldValue(source, field, row, lookups, warnings);
    if (value !== null) {
      values[field.key] = value;
    }
  }

  const updatedAt = new Date(
    Math.max(
      createdAt.getTime(),
      ...stages.map((stage) => stage.updatedAt.getTime()),
    ),
  );
  return {
    ok: true,
    value: {
      id: CaseId.trust(input.newId()),
      organizationId: organization,
      holderUserId: owner,
      values,
      createdAt,
      updatedAt,
      stages,
    },
  };
}

function planBranches(
  snapshot: SafeappSnapshot,
  newId: () => string,
): Map<string, CutoverBranch> {
  const branches = new Map<string, CutoverBranch>();
  for (const row of snapshot.tienda) {
    const id = sourceId(row.id_tienda);
    if (id) {
      branches.set(id, {
        id: BranchId.trust(newId()),
        name: text(row.nombre) ?? `Tienda ${id}`,
      });
    }
  }
  return branches;
}

function planUsers(
  snapshot: SafeappSnapshot,
  branches: Map<string, CutoverBranch>,
  input: CutoverInput,
  skipped: SkippedRow[],
): { users: Map<string, CutoverUser>; noTienda: CutoverBranch | null } {
  const roleNames = new Map(
    snapshot.rol.map((row) => [sourceId(row.id_rol), text(row.nombre_rol)]),
  );
  const permisoOfMenu = new Map(
    snapshot.menu.map((row) => [sourceId(row.id_menu), text(row.permiso)]),
  );
  const permisos = new Map<string, Set<string>>();
  for (const row of snapshot.acceso) {
    const user = sourceId(row.id_usuario);
    const permiso = permisoOfMenu.get(sourceId(row.id_menu));
    if (user && permiso) {
      permisos.set(user, (permisos.get(user) ?? new Set()).add(permiso));
    }
  }
  // asignacion_tienda's estado 0 marks the active tienda.
  const tiendaOf = new Map<string, string>();
  for (const row of snapshot.asignacion_tienda.toSorted(
    (a, b) => Number(text(a.estado) !== "0") - Number(text(b.estado) !== "0"),
  )) {
    const user = sourceId(row.id_usuario);
    const tienda = sourceId(row.id_tienda);
    if (user && tienda && branches.has(tienda) && !tiendaOf.has(user)) {
      tiendaOf.set(user, tienda);
    }
  }

  let noTienda: CutoverBranch | null = null;
  const users = new Map<string, CutoverUser>();
  const usernames = new Set<string>();
  const emails = new Set<string>();
  for (const row of snapshot.usuario) {
    const id = sourceId(row.id_usuario);
    const username = text(row.usuario)?.toLowerCase();
    if (!id) {
      continue;
    }
    if (!username || usernames.has(username)) {
      skipped.push({
        table: "usuario",
        sourceId: id,
        reason: username ? "username_repeated" : "username_missing",
      });
      continue;
    }
    usernames.add(username);
    const correo = text(row.correo)?.toLowerCase();
    const email =
      correo?.includes("@") && !emails.has(correo)
        ? correo
        : `${username}@${PLACEHOLDER_EMAIL_DOMAIN}`;
    emails.add(email);
    const tienda = tiendaOf.get(id);
    const branch =
      (tienda ? branches.get(tienda) : undefined) ??
      (noTienda ??= { id: BranchId.trust(input.newId()), name: NO_TIENDA });
    users.set(id, {
      id: UserId.trust(input.newId()),
      branchId: branch.id,
      username,
      email,
      ...splitPersonal(text(row.personal)),
      roleKey: roleFromGrants(
        roleNames.get(sourceId(row.id_rol)) ?? null,
        permisos.get(id) ?? new Set(),
      ),
      isActive: text(row.estado) === "1",
    });
  }
  return { users, noTienda };
}

function planOrganizations(
  snapshot: SafeappSnapshot,
  newId: () => string,
  skipped: SkippedRow[],
): Map<string, CutoverOrganization> {
  // A workspace holds one organization per RUC. safeapp may hold a RUC twice,
  // so both clientes map to the first.
  const byRuc = new Map<string, CutoverOrganization>();
  const organizations = new Map<string, CutoverOrganization>();
  for (const row of snapshot.cliente) {
    const id = sourceId(row.id_cliente);
    if (!id) {
      continue;
    }
    const ruc = parseRuc(text(row.ruc) ?? "");
    if (isErr(ruc)) {
      skipped.push({ table: "cliente", sourceId: id, reason: "invalid_ruc" });
      continue;
    }
    const organization = byRuc.get(ruc.value) ?? {
      id: OrganizationId.trust(newId()),
      ruc: ruc.value,
      legalName: text(row.razon_social),
    };
    byRuc.set(ruc.value, organization);
    organizations.set(id, organization);
  }
  return organizations;
}

// The catalogs hold the active entries and every entry a case still names,
// so an imported case keeps a value its form offers.
function planCatalog(snapshot: SafeappSnapshot): {
  catalog: EntelCatalog;
  carteras: Map<string, string>;
} {
  const carteras = new Map<string, string>();
  for (const row of snapshot.cartera) {
    const id = sourceId(row.id_cartera);
    const name = text(row.nombre);
    if (id && name) {
      carteras.set(id, name);
    }
  }
  const activeCarteras = snapshot.cartera
    .filter((row) => text(row.estado) === "1")
    .map((row) => text(row.nombre));
  const usedCarteras = snapshot.nc_movil.map(
    (row) => carteras.get(sourceId(row.id_cartera) ?? "") ?? null,
  );
  const activeProducts = snapshot.producto
    .filter((row) => text(row.tipo) === "FIJA" && text(row.estado) === "1")
    .map(fixedProductLabel);
  const usedProducts = snapshot.nc_fija.map(fixedProductLabel);
  return {
    catalog: {
      carteras: sortedUnique([...activeCarteras, ...usedCarteras]),
      fixedProducts: sortedUnique([...activeProducts, ...usedProducts]),
    },
    carteras,
  };
}

// Maps a safeapp snapshot onto one Entel workspace. It writes nothing; the
// loader stores the plan.
export function planSafeappCutover(input: CutoverInput): CutoverPlan {
  const { snapshot } = input;
  const skipped: SkippedRow[] = [];
  const warnings = new Warnings();

  const branches = planBranches(snapshot, input.newId);
  const { users, noTienda } = planUsers(snapshot, branches, input, skipped);
  const organizations = planOrganizations(snapshot, input.newId, skipped);
  const { catalog, carteras } = planCatalog(snapshot);
  const caseTypes = entelCaseTypes(catalog);

  const lookups: Lookups = {
    branches: new Map(
      [...branches].map(([id, branch]) => [id, branch.id] as const),
    ),
    users: new Map([...users].map(([id, user]) => [id, user.id] as const)),
    organizations: new Map(
      [...organizations].map(([id, org]) => [id, org.id] as const),
    ),
    carteras,
  };

  const cases: CutoverPlan["cases"] = [];
  for (const source of CASE_SOURCES) {
    const definition = caseTypes.find(
      (each) => each.key === source.caseTypeKey,
    );
    if (!definition) {
      throw new Error(`entel_case_type_missing:${source.caseTypeKey}`);
    }
    for (const row of snapshot[source.table]) {
      const planned = caseFromRow(
        source,
        definition,
        row,
        lookups,
        input,
        warnings,
      );
      if (planned.ok) {
        cases.push({ ...planned.value, caseTypeKey: source.caseTypeKey });
      } else {
        skipped.push({
          table: source.table,
          sourceId: sourceId(row[source.idColumn]) ?? "?",
          reason: planned.reason,
        });
      }
    }
  }

  const campaigns = planCampaigns({
    snapshot,
    newId: input.newId,
    at: input.at,
    users,
    organizations: lookups.organizations,
    skipped,
    warnings,
  });

  return {
    branches: [...branches.values(), ...(noTienda ? [noTienda] : [])],
    users: [...users.values()],
    organizations: [...new Set(organizations.values())],
    caseTypes,
    cases,
    ...campaigns,
    report: { skipped, warnings: warnings.counts },
  };
}
