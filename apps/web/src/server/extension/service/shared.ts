import type { WorkspaceId } from "~/domain/ids";
import type { ActivitiesRepo } from "~/server/activities/infrastructure/activities-repo";
import type { AppUow } from "~/server/platform/database/uow";
import type { BlobStore } from "~/server/platform/files/blob-store";
import type { SessionRepository } from "~/server/sessions/repos-sessions";
import type { MembersRepo } from "~/server/users/repos-members";

import type { ExtensionRecordingsRepo } from "../recordings-repo";
import type { ExtensionRuntimeRepo } from "../repos";

export type ExtensionRepos = {
  activities: ActivitiesRepo;
  extensionRecordings: ExtensionRecordingsRepo;
  extensionRuntime: ExtensionRuntimeRepo;
  authSessions: Pick<SessionRepository, "findById">;
  members: MembersRepo;
};

export interface ExtensionServiceDeps {
  workspaceId: WorkspaceId;
  uow: AppUow<ExtensionRepos>;
  storage: BlobStore;
}

export async function hasActiveAuthSession(
  repos: ExtensionRepos,
  authSessionId: string,
  activeAsOf: Date,
): Promise<boolean> {
  const authSession = await repos.authSessions.findById(authSessionId);
  if (!authSession || authSession.expires_at <= activeAsOf) {
    return false;
  }

  const user = await repos.members.findById(authSession.user_id);
  return (
    user != null &&
    user.is_active &&
    (user.expires_at === null || user.expires_at > activeAsOf)
  );
}
