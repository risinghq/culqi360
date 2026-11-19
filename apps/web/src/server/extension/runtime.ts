import { createActivitiesRepo } from "~/server/activities/infrastructure/activities-repo";
import { createExtensionRecordingsRepo } from "~/server/extension/recordings-repo";
import { createExtensionRuntimeRepo } from "~/server/extension/repos";
import { createExtensionService } from "~/server/extension/service";
import type { ExtensionRepos } from "~/server/extension/service/shared";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import { createExecutorUow } from "~/server/platform/database/uow";
import type { BlobStore } from "~/server/platform/files/blob-store";
import type { WorkspaceInfrastructure } from "~/server/platform/infrastructure";
import { createSessionRepository } from "~/server/sessions/repos-sessions";
import { createMembersRepo } from "~/server/users/repos-members";

export function createExtensionRuntime(
  workspace: WorkspaceInfrastructure,
  storage: BlobStore,
) {
  return createExtensionService(extensionRepos(workspace.db), {
    workspaceId: workspace.workspaceId,
    uow: createExecutorUow(workspace.db, extensionRepos),
    storage,
  });
}

export function extensionRepos(db: WorkspaceExecutor): ExtensionRepos {
  return {
    activities: createActivitiesRepo(db),
    extensionRecordings: createExtensionRecordingsRepo(db),
    extensionRuntime: createExtensionRuntimeRepo(db),
    authSessions: createSessionRepository(db),
    members: createMembersRepo(db),
  };
}
