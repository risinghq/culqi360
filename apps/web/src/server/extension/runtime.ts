import {
  createActivitiesRepo,
  type ActivitiesRepo,
} from "~/server/activities/infrastructure/activities-repo";
import {
  createExtensionRecordingsRepo,
  type ExtensionRecordingsRepo,
} from "~/server/extension/recordings-repo";
import {
  createExtensionRuntimeRepo,
  type ExtensionRuntimeRepo,
} from "~/server/extension/repos";
import { createExtensionService } from "~/server/extension/service";
import { createExecutorUow } from "~/server/platform/database/uow";
import type { BlobStore } from "~/server/platform/files/blob-store";
import type { ServerInfrastructure } from "~/server/platform/infrastructure";
import {
  createSessionRepository,
  type SessionRepository,
} from "~/server/sessions/repos-sessions";
import { createUsersRepo, type UsersRepo } from "~/server/users/repos-users";

type ExtensionRuntimeRepos = {
  activities: ActivitiesRepo;
  extensionRecordings: ExtensionRecordingsRepo;
  extensionRuntime: ExtensionRuntimeRepo;
  sessions: SessionRepository;
  users: UsersRepo;
};

function buildRepos(db: ServerInfrastructure["db"]): ExtensionRuntimeRepos {
  return {
    activities: createActivitiesRepo(db),
    extensionRecordings: createExtensionRecordingsRepo(db),
    extensionRuntime: createExtensionRuntimeRepo(db),
    sessions: createSessionRepository(db),
    users: createUsersRepo(db),
  };
}

export function createExtensionRuntime(
  serverInfrastructure: ServerInfrastructure,
  storage: BlobStore,
) {
  return createExtensionService(buildRepos(serverInfrastructure.db), {
    uow: createExecutorUow(serverInfrastructure.db, buildRepos),
    storage,
  });
}
