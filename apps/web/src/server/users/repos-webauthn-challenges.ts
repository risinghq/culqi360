import type { Kysely } from "kysely";

import { type UserId, WebauthnChallengeId } from "~/domain/ids";
import type { PlatformDatabase } from "~/server/platform/database/types";

export function createWebauthnChallengesRepo(db: Kysely<PlatformDatabase>) {
  return {
    async create(values: {
      account_id: UserId | null;
      type: string;
      challenge: string;
      expires_at: Date;
      created_at: Date;
    }): Promise<WebauthnChallengeId> {
      const id = WebauthnChallengeId.mint();
      await db
        .insertInto("webauthn_challenges")
        .values({ id, ...values })
        .execute();
      return id;
    },

    findById(id: WebauthnChallengeId) {
      return db
        .selectFrom("webauthn_challenges")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
    },

    async delete(id: WebauthnChallengeId): Promise<void> {
      await db.deleteFrom("webauthn_challenges").where("id", "=", id).execute();
    },

    // A challenge verifies once: the delete that removes it is the verdict.
    async consume(id: WebauthnChallengeId): Promise<boolean> {
      const result = await db
        .deleteFrom("webauthn_challenges")
        .where("id", "=", id)
        .executeTakeFirst();
      return Number(result.numDeletedRows ?? 0) > 0;
    },

    async nextExpiryAt(): Promise<Date | null> {
      const row = await db
        .selectFrom("webauthn_challenges")
        .select("expires_at")
        .orderBy("expires_at")
        .limit(1)
        .executeTakeFirst();
      return row?.expires_at ?? null;
    },

    async deleteExpired(expiredBefore: Date): Promise<number> {
      const result = await db
        .deleteFrom("webauthn_challenges")
        .where("expires_at", "<", expiredBefore)
        .executeTakeFirst();

      return Number(result.numDeletedRows ?? 0);
    },
  };
}

export type WebauthnChallengesRepo = ReturnType<
  typeof createWebauthnChallengesRepo
>;
