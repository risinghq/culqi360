import { effectivePermissions } from "~/domain/auth/access/workspace-modules";
import type { UserId } from "~/domain/ids";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import { readWorkspaceModules } from "~/server/roles/workspace-settings";

import type { WorkflowActor } from "./actor";

// A stored user as a workflow actor, for work done on their behalf outside
// their request: an import they started, an answer they gave earlier. The
// permissions are the role's as they stand now, like a session's.
export async function loadWorkflowActor(
  executor: WorkspaceExecutor,
  userId: UserId,
): Promise<WorkflowActor | undefined> {
  const user = await executor
    .selectFrom("members")
    .innerJoin("workspace_roles", "workspace_roles.id", "members.role_id")
    .select([
      "members.user_id",
      "members.role",
      "members.branch_id",
      "workspace_roles.permissions",
    ])
    .where("members.user_id", "=", userId)
    .executeTakeFirst();
  if (!user) {
    return undefined;
  }
  return {
    userId: user.user_id,
    role: user.role,
    permissions: effectivePermissions(
      user.permissions,
      await readWorkspaceModules(executor),
    ),
    branchId: user.branch_id,
  };
}
