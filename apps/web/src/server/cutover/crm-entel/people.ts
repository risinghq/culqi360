import { parseRuc } from "~/domain/identity/document";
import { BranchId, OrganizationId, TeamId, UserId } from "~/domain/ids";
import { isErr } from "~/shared/result";

import type {
  CutoverBranch,
  CutoverOrganization,
  CutoverTeam,
  CutoverUser,
} from "../shared/plan";
import { sourceId, text, type SkippedRow } from "../shared/rows";
import type { CrmEntelSnapshot } from "./source";

const PLACEHOLDER_EMAIL_DOMAIN = "crm-entel.invalid";
// Usernames are unique across workspaces, and CRM Entel shares people and
// their handles with the Entel workspace imported from safeapp.
const USERNAME_PREFIX = "crm.";
const NO_ZONAL = "Sin zonal";

const ROLE_OF: Readonly<Record<string, string>> = {
  EJECUTIVO: "executive",
  SUPERVISOR: "supervisor",
  BACKOFFICE: "back_office",
  ANALISTA: "back_office",
  JEFE_COMERCIAL: "sales_manager",
  ADMINISTRADOR: "admin",
  SUPERADMINISTRADOR: "admin",
};

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase());
}

function splitSurnames(apellidos: string | null): {
  firstSurname: string;
  secondSurname: string;
} {
  const words = (apellidos ?? "").split(/\s+/).filter(Boolean);
  return {
    firstSurname: words[0] ?? "",
    secondSurname: words.slice(1).join(" "),
  };
}

export type PeoplePlan = {
  branches: CutoverBranch[];
  teams: CutoverTeam[];
  users: Map<string, CutoverUser>;
};

// A zonal is a branch. A jefe's reports form a team in the jefe's zonal.
export function planPeople(
  snapshot: CrmEntelSnapshot,
  newId: () => string,
  skipped: SkippedRow[],
): PeoplePlan {
  const branches = new Map<string, CutoverBranch>();
  const branchOf = (zonal: string | null) => {
    const name = zonal ? titleCase(zonal) : NO_ZONAL;
    const branch = branches.get(name) ?? { id: BranchId.trust(newId()), name };
    branches.set(name, branch);
    return branch;
  };

  const rows = new Map(
    snapshot.usuarios.map((row) => [sourceId(row.id) ?? "", row]),
  );
  const users = new Map<string, CutoverUser>();
  for (const [id, row] of rows) {
    const handle = text(row.username)?.toLowerCase();
    const username = handle ? `${USERNAME_PREFIX}${handle}` : null;
    const roleKey = ROLE_OF[text(row.rol) ?? ""];
    if (!id || !username || !roleKey) {
      skipped.push({
        table: "usuarios",
        sourceId: id || "?",
        reason: !username ? "username_missing" : "role_unknown",
      });
      continue;
    }
    users.set(id, {
      id: UserId.trust(newId()),
      branchId: branchOf(text(row.zonal)).id,
      teamId: null,
      username,
      email: `${username}@${PLACEHOLDER_EMAIL_DOMAIN}`,
      names: text(row.nombre) ?? username,
      ...splitSurnames(text(row.apellidos)),
      roleKey,
      isActive: text(row.activo) === "true",
    });
  }

  const teams = new Map<string, CutoverTeam>();
  for (const [id, row] of rows) {
    const user = users.get(id);
    const jefeId = sourceId(row.jefe_id);
    const jefe = jefeId ? users.get(jefeId) : undefined;
    if (!user || !jefeId || !jefe) {
      continue;
    }
    const team = teams.get(jefeId) ?? {
      id: TeamId.trust(newId()),
      branchId: jefe.branchId,
      name: `Equipo ${jefe.names} ${jefe.firstSurname}`.trim(),
    };
    teams.set(jefeId, team);
    // A member's team sits in the member's branch.
    if (team.branchId === user.branchId) {
      user.teamId = team.id;
    }
  }
  return {
    branches: [...branches.values()],
    teams: [...teams.values()],
    users,
  };
}

// One organization per RUC. A company's first phone and its district come
// with it; its address and owner names stay behind.
export function planOrganizations(
  snapshot: CrmEntelSnapshot,
  newId: () => string,
  skipped: SkippedRow[],
): Map<string, CutoverOrganization> {
  const firstPhone = new Map<string, string>();
  for (const row of snapshot.telefonos.toSorted(
    (a, b) => Number(a.id) - Number(b.id),
  )) {
    const cliente = sourceId(row.cliente_id);
    const numero = text(row.numero);
    if (cliente && numero && !firstPhone.has(cliente)) {
      firstPhone.set(cliente, numero);
    }
  }
  const byRuc = new Map<string, CutoverOrganization>();
  const organizations = new Map<string, CutoverOrganization>();
  for (const row of snapshot.clientes) {
    const id = sourceId(row.id);
    if (!id) {
      continue;
    }
    const ruc = parseRuc(text(row.ruc) ?? "");
    if (isErr(ruc)) {
      skipped.push({ table: "clientes", sourceId: id, reason: "invalid_ruc" });
      continue;
    }
    const organization = byRuc.get(ruc.value) ?? {
      id: OrganizationId.trust(newId()),
      ruc: ruc.value,
      legalName: text(row.razon_social),
      district: text(row.distrito),
      phone: firstPhone.get(id) ?? null,
    };
    byRuc.set(ruc.value, organization);
    organizations.set(id, organization);
  }
  return organizations;
}
