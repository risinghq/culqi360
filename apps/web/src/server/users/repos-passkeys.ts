import type { Kysely } from "kysely";

import type { UserId } from "~/domain/ids";
import type { PlatformDatabase } from "~/server/platform/database/types";

export function createPasskeysRepo(db: Kysely<PlatformDatabase>) {
  return {
    findById(id: string) {
      return db
        .selectFrom("passkeys")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
    },

    findByAccount(accountId: UserId) {
      return db
        .selectFrom("passkeys")
        .selectAll()
        .where("account_id", "=", accountId)
        .execute();
    },

    // `id` is the credential id the authenticator returned.
    create(values: {
      id: string;
      account_id: UserId;
      public_key: string;
      counter: number;
      transports: string | null;
      created_at: Date;
    }) {
      return db.insertInto("passkeys").values(values).executeTakeFirstOrThrow();
    },

    async updateCounter(
      id: string,
      expectedCounter: number,
      counter: number,
      usedAt: Date,
    ): Promise<boolean> {
      const result = await db
        .updateTable("passkeys")
        .set({ counter, last_used_at: usedAt })
        .where("id", "=", id)
        .where("counter", "=", expectedCounter)
        .executeTakeFirst();
      return Number(result.numUpdatedRows ?? 0) > 0;
    },

    deleteAllByAccount(accountId: UserId) {
      return db
        .deleteFrom("passkeys")
        .where("account_id", "=", accountId)
        .execute();
    },
  };
}

export type PasskeysRepo = ReturnType<typeof createPasskeysRepo>;
