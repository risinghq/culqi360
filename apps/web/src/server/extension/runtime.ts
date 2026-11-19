import type { Kysely } from "kysely";

import { createActivitiesRepo } from "~/server/activities/infrastructure/activities-repo";
import { createExtensionRecordingsRepo } from "~/server/extension/recordings-repo";
import { createExtensionRuntimeRepo } from "~/server/extension/repos";
import { createExtensionService } from "~/server/extension/service";
import type {
  AuthSessionLookup,
  ExtensionRepos,
} from "~/server/extension/service/shared";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { PlatformDatabase } from "~/server/platform/database/types";
import { createExecutorUow } from "~/server/platform/database/uow";
import type { BlobStore } from "~/server/platform/files/blob-store";
import type { WorkspaceInfrastructure } from "~/server/platform/infrastructure";
import { createMembersRepo } from "~/server/users/repos-members";

export function createExtensionRuntime(
  platform: Kysely<PlatformDatabase>,
  workspace: WorkspaceInfrastructure,
  storage: BlobStore,
) {
  const buildRepos = extensionReposBinder(platform, workspace);
  return createExtensionService(buildRepos(workspace.db), {
    uow: createExecutorUow(workspace.db, buildRepos),
    storage,
  });
}

export function extensionReposBinder(
  platform: Kysely<PlatformDatabase>,
  workspace: WorkspaceInfrastructure,
): (db: WorkspaceExecutor) => ExtensionRepos {
  const authSessions = createAuthSessionLookup(platform, workspace);
  return (db) => ({
    activities: createActivitiesRepo(db),
    extensionRecordings: createExtensionRecordingsRepo(db),
    extensionRuntime: createExtensionRuntimeRepo(db),
    authSessions,
    members: createMembersRepo(db),
  });
}

function createAuthSessionLookup(
  platform: Kysely<PlatformDatabase>,
  workspace: WorkspaceInfrastructure,
): AuthSessionLookup {
  return {
    async findById(id) {
      const session = await platform
        .selectFrom("user_sessions")
        .select(["account_id", "expires_at"])
        .where("id", "=", id)
        .where("workspace_id", "=", workspace.workspaceId)
        .executeTakeFirst();
      return session ?? null;
    },
  };
}
