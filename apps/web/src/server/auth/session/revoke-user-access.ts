import type { UserId, WorkspaceId } from "~/domain/ids";
import type {
  AccessSecurityTx,
  AuthWorkspaces,
} from "~/server/auth/application/ports";

/**
 * Deletes every session of the account. Returns the account's workspaces so
 * the caller ends extension access there after the platform commit.
 */
export async function revokeUserAccess(
  tx: Pick<AccessSecurityTx, "sessions" | "users">,
  accountId: UserId,
): Promise<readonly WorkspaceId[]> {
  await tx.sessions.deleteAllForAccount(accountId);
  return tx.users.listWorkspaceIds(accountId);
}

export async function endExtensionAccessIn(
  workspaces: AuthWorkspaces,
  workspaceIds: readonly WorkspaceId[],
  input: { accountId: UserId; endedAt: Date },
): Promise<void> {
  await Promise.all(
    workspaceIds.map((workspaceId) =>
      workspaces.endExtensionAccess(workspaceId, input),
    ),
  );
}
