import type { Kysely } from "kysely";

import type { UserId, WorkspaceId } from "~/domain/ids";
import type { PlatformDatabase } from "~/server/platform/database/types";
import type { BlobStore } from "~/server/platform/files/blob-store";

import { type AvatarService, createAvatarService } from "./avatar-service";
import { createAccountsRepo } from "./repos-accounts";
import type { MemberIdentity } from "./repos-members";
import { createMembershipsRepo } from "./repos-memberships";

// Writes the account's identity copy into one workspace's member row.
export type MemberIdentitySync = (
  workspaceId: WorkspaceId,
  accountId: UserId,
  values: Partial<MemberIdentity>,
) => Promise<void>;

// The avatar belongs to the account. Each workspace the account belongs to
// keeps a copy of its key and version for rosters, refreshed after the
// account row commits.
export function createAccountAvatars(
  db: Kysely<PlatformDatabase>,
  blobStore: BlobStore,
  syncMember: MemberIdentitySync,
): AvatarService {
  const accounts = createAccountsRepo(db);
  const memberships = createMembershipsRepo(db);

  async function refreshCopies(accountId: UserId): Promise<void> {
    const meta = await accounts.findAvatarMetaById(accountId);
    if (!meta) {
      return;
    }
    const workspaces = await memberships.listWorkspacesForAccount(accountId);
    for (const workspace of workspaces) {
      // eslint-disable-next-line no-await-in-loop
      await syncMember(workspace.id, accountId, {
        avatar_storage_key: meta.avatar_storage_key,
        avatar_version: meta.avatar_version,
      });
    }
  }

  const avatars = createAvatarService({ users: accounts }, blobStore);

  return {
    get: (accountId) => avatars.get(accountId),
    async upload(accountId, file, updatedAt) {
      const uploaded = await avatars.upload(accountId, file, updatedAt);
      if (uploaded.ok) {
        await refreshCopies(accountId);
      }
      return uploaded;
    },
    async remove(accountId, updatedAt) {
      const removed = await avatars.remove(accountId, updatedAt);
      if (removed.ok) {
        await refreshCopies(accountId);
      }
      return removed;
    },
  };
}
