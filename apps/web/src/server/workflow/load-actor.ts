import {
  effectivePermissions,
  isWorkspaceModule,
} from "~/domain/auth/access/workspace-modules";
import type { UserId } from "~/domain/ids";
import type { DatabaseExecutor } from "~/server/platform/database/executor";

import type { WorkflowActor } from "./actor";

// A stored user as a workflow actor, for work done on their behalf outside
// their request: an import they started, an answer they gave earlier. The
// permissions are the role's as they stand now, like a session's.
export async function loadWorkflowActor(
  executor: DatabaseExecutor,
  userId: UserId,
): Promise<WorkflowActor | undefined> {
  const user = await executor
    .selectFrom("users")
    .innerJoin("workspaces", "workspaces.id", "users.workspace_id")
    .innerJoin("workspace_roles", "workspace_roles.id", "users.role_id")
    .select([
      "users.id",
      "users.role",
      "users.branch_id",
      "workspaces.modules",
      "workspace_roles.permissions",
    ])
    .where("users.id", "=", userId)
    .executeTakeFirst();
  if (!user) {
    return undefined;
  }
  return {
    userId: user.id,
    role: user.role,
    permissions: effectivePermissions(
      user.permissions,
      user.modules.filter(isWorkspaceModule),
    ),
    branchId: user.branch_id,
  };
}
