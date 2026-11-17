import { sql, type Kysely } from "kysely";

import {
  BASELINE_ASSIGNABLE,
  BASELINE_PERMISSIONS,
  LOCKED_BASELINE_ROLES,
  ROLES,
  type Permission,
  type Role,
} from "~/domain/auth/access/rbac";
import { getRoleLabel } from "~/domain/auth/access/role-display";
import type { WorkspaceModule } from "~/domain/auth/access/workspace-modules";
import type { WorkspaceId } from "~/domain/ids";
import type { Database } from "~/server/platform/database/types";
import { WORKSPACE_SETTING } from "~/server/platform/database/workspace-scope";

// A role a workspace starts with. `assignedBy` lists the keys of the roles
// whose holders may assign it; the admin kinds assign it without being listed.
export interface RoleSeed {
  key: string;
  name: string;
  kind: Role;
  permissions: readonly Permission[];
  assignedBy?: readonly string[];
}

export interface NewWorkspace {
  id: WorkspaceId;
  name: string;
  modules: readonly WorkspaceModule[];
  createdAt: Date;
  // Roles the workspace needs beyond the baseline, such as Entel's validador.
  extraRoles?: readonly RoleSeed[];
}

const BASELINE_ROLES: readonly RoleSeed[] = ROLES.map((kind) => ({
  key: kind,
  name: getRoleLabel(kind),
  kind,
  permissions: BASELINE_PERMISSIONS[kind],
  assignedBy: ROLES.filter((assigner) =>
    BASELINE_ASSIGNABLE[assigner]?.includes(kind),
  ),
}));

// Inserts the workspace with its baseline roles, then moves the transaction
// into it: the setting is transaction-local, so the column defaults tag every
// later row with the new workspace. Run it in a transaction at platform scope.
export async function createWorkspace(
  trx: Kysely<Database>,
  workspace: NewWorkspace,
): Promise<void> {
  await trx
    .insertInto("workspaces")
    .values({
      id: workspace.id,
      name: workspace.name,
      modules: [...workspace.modules],
      created_at: workspace.createdAt,
    })
    .execute();
  await sql`select set_config(${WORKSPACE_SETTING}, ${workspace.id}, true)`.execute(
    trx,
  );
  await insertRoles(
    trx,
    [...BASELINE_ROLES, ...(workspace.extraRoles ?? [])],
    workspace.createdAt,
  );
}

async function insertRoles(
  trx: Kysely<Database>,
  seeds: readonly RoleSeed[],
  at: Date,
): Promise<void> {
  const rows = await trx
    .insertInto("workspace_roles")
    .values(
      seeds.map((seed) => ({
        key: seed.key,
        name: seed.name,
        kind: seed.kind,
        permissions: [...seed.permissions],
        locked: LOCKED_BASELINE_ROLES.some((kind) => kind === seed.key),
        created_at: at,
      })),
    )
    .returning(["id", "key"])
    .execute();
  const idOf = new Map(rows.map((row) => [row.key, row.id]));
  const assignables = seeds.flatMap((seed) =>
    (seed.assignedBy ?? []).flatMap((assignerKey) => {
      const assigner = idOf.get(assignerKey);
      const assignable = idOf.get(seed.key);
      return assigner === undefined || assignable === undefined
        ? []
        : [{ role_id: assigner, assignable_role_id: assignable }];
    }),
  );
  if (assignables.length > 0) {
    await trx
      .insertInto("workspace_role_assignables")
      .values(assignables)
      .execute();
  }
}
