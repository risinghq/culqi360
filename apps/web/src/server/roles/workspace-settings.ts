import {
  isWorkspaceModule,
  type WorkspaceModule,
} from "~/domain/auth/access/workspace-modules";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";

// The modules this workspace runs. createWorkspace writes the one settings row.
export async function readWorkspaceModules(
  db: WorkspaceExecutor,
): Promise<WorkspaceModule[]> {
  const row = await db
    .selectFrom("workspace_settings")
    .select("modules")
    .where("id", "=", 1)
    .executeTakeFirstOrThrow();
  return row.modules.filter(isWorkspaceModule);
}
