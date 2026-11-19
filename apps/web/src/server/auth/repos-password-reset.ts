import { v7 as uuidv7 } from "uuid";

import type { UserId } from "~/domain/ids";
import type { PlatformExecutor } from "~/server/platform/database/executor";

export function createPasswordResetTokensRepo(db: PlatformExecutor) {
  return {
    create(values: {
      account_id: UserId;
      token_hash: string;
      expires_at: Date;
      created_at: Date;
    }) {
      return db
        .insertInto("password_reset_tokens")
        .values({ id: uuidv7(), ...values, used_at: null })
        .execute();
    },

    findValidByHash(tokenHash: string, activeAsOf: Date) {
      return db
        .selectFrom("password_reset_tokens")
        .selectAll()
        .where("token_hash", "=", tokenHash)
        .where("expires_at", ">", activeAsOf)
        .where("used_at", "is", null)
        .executeTakeFirst();
    },

    async countRecentForAccount(
      accountId: UserId,
      since: Date,
    ): Promise<number> {
      const row = await db
        .selectFrom("password_reset_tokens")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("account_id", "=", accountId)
        .where("created_at", ">=", since)
        .executeTakeFirstOrThrow();
      return row.count;
    },

    markUsed(id: string, usedAt: Date) {
      return db
        .updateTable("password_reset_tokens")
        .set({ used_at: usedAt })
        .where("id", "=", id)
        .execute();
    },

    expireAllForAccount(accountId: UserId, expiredAt: Date) {
      return db
        .updateTable("password_reset_tokens")
        .set({ used_at: expiredAt })
        .where("account_id", "=", accountId)
        .where("used_at", "is", null)
        .execute();
    },
  };
}

export type PasswordResetTokensRepo = ReturnType<
  typeof createPasswordResetTokensRepo
>;
