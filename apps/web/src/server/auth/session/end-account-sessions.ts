import type { UserId } from "~/domain/ids";
import type { AuthWorkspaces } from "~/server/auth/application/ports";
import type { AuthIdentitiesRepo } from "~/server/auth/identities";

// An account's sessions live in each of its workspaces, so ending them all is
// one call per workspace. Run it after the platform commit that changed the
// credential: a failure here leaves the new credential in place and the error
// with the caller, who can retry.
export async function endAccountSessions(
  deps: {
    users: Pick<AuthIdentitiesRepo, "listWorkspaceIds">;
    workspaces: Pick<AuthWorkspaces, "endSessions">;
  },
  input: { userId: UserId; endedAt: Date },
): Promise<void> {
  const workspaceIds = await deps.users.listWorkspaceIds(input.userId);
  await Promise.all(
    workspaceIds.map((workspaceId) =>
      deps.workspaces.endSessions(workspaceId, input),
    ),
  );
}
