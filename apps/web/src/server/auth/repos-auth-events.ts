import type { Insertable, Kysely, Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";

import type { UserId } from "~/domain/ids";
import type { PlatformDatabase } from "~/server/platform/database/types";

type AuthEventRow = Selectable<PlatformDatabase["auth_events"]>;
type NewAuthEventRow = Omit<Insertable<PlatformDatabase["auth_events"]>, "id">;

const RETRY_STAGES = ["login", "challenge", "verify", "recovery"] as const;
const RETRY_OUTCOMES = ["failure", "throttled"] as const;

export function createAuthEventsRepo(db: Kysely<PlatformDatabase>) {
  return {
    create(values: NewAuthEventRow) {
      return db
        .insertInto("auth_events")
        .values({ id: uuidv7(), ...values })
        .executeTakeFirst();
    },

    findRecentByAccount(accountId: UserId, limit: number) {
      return (
        db
          .selectFrom("auth_events")
          .selectAll()
          .where("account_id", "=", accountId)
          // `id` (uuidv7, time-sortable) breaks ties when several events
          // share one `created_at`, such as a burst of retries in the same
          // millisecond.
          .orderBy("created_at", "desc")
          .orderBy("id", "desc")
          .limit(limit)
          .execute()
      );
    },

    findRecentLoginRetriesByAccount(accountId: UserId, limit: number) {
      return db
        .selectFrom("auth_events")
        .selectAll()
        .where("account_id", "=", accountId)
        .where("stage", "in", RETRY_STAGES)
        .where("outcome", "in", RETRY_OUTCOMES)
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .limit(limit)
        .execute();
    },

    countLoginRetriesSince(accountId: UserId, since: Date) {
      return db
        .selectFrom("auth_events")
        .select((eb) => eb.fn.count<number>("id").as("total"))
        .where("account_id", "=", accountId)
        .where("stage", "in", RETRY_STAGES)
        .where("outcome", "in", RETRY_OUTCOMES)
        .where("created_at", ">=", since)
        .executeTakeFirst()
        .then((row) => row?.total ?? 0);
    },

    findLastByIdentifier(
      identifierHash: string,
    ): Promise<AuthEventRow | undefined> {
      return db
        .selectFrom("auth_events")
        .selectAll()
        .where("identifier_hash", "=", identifierHash)
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .executeTakeFirst();
    },

    async oldestCreatedAt(): Promise<Date | null> {
      const row = await db
        .selectFrom("auth_events")
        .select("created_at")
        .orderBy("created_at")
        .limit(1)
        .executeTakeFirst();
      return row?.created_at ?? null;
    },

    deleteCreatedBefore(createdBefore: Date) {
      return db
        .deleteFrom("auth_events")
        .where("created_at", "<", createdBefore)
        .executeTakeFirst()
        .then((result) => Number(result.numDeletedRows ?? 0));
    },
  };
}

export type AuthEventsRepo = ReturnType<typeof createAuthEventsRepo>;
