import { sql, type RawBuilder } from "kysely";

import type { Role } from "~/domain/auth/access/rbac";
import type { RoleId } from "~/domain/ids";
import { scopeWorkspace } from "~/server/platform/database/schema/workspace-column";

// A user's role columns for the current workspace's role with this key, for
// inserts that name a role by key: seeds, the cutover and test fixtures. The
// insert fails on the not-null check when the workspace has no such role.
export function roleByKey(key: string): {
  role_id: RawBuilder<RoleId>;
  role: RawBuilder<Role>;
} {
  return {
    role_id: sql<RoleId>`(select id from workspace_roles where workspace_id = ${scopeWorkspace} and key = ${key})`,
    role: sql<Role>`(select kind from workspace_roles where workspace_id = ${scopeWorkspace} and key = ${key})`,
  };
}
