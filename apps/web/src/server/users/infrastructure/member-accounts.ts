import type { Kysely } from "kysely";

import { createPasswordResetTokensRepo } from "~/server/auth/repos-password-reset";
import type { PlatformDatabase } from "~/server/platform/database/types";
import type { MemberAccountsPort } from "~/server/users/application/ports";
import { createMembershipsRepo } from "~/server/users/repos-memberships";

export function createMemberAccounts(
  db: Kysely<PlatformDatabase>,
): MemberAccountsPort {
  return {
    removeMembership(workspaceId, accountId) {
      return createMembershipsRepo(db).remove(accountId, workspaceId);
    },

    async replaceResetToken(input) {
      await db.transaction().execute(async (tx) => {
        const tokens = createPasswordResetTokensRepo(tx);
        await tokens.expireAllForAccount(input.accountId, input.createdAt);
        await tokens.create({
          account_id: input.accountId,
          token_hash: input.tokenHash,
          expires_at: input.expiresAt,
          created_at: input.createdAt,
        });
      });
    },
  };
}
