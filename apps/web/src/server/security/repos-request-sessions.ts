import type { Insertable, Kysely, Selectable } from "kysely";

import type { PlatformDatabase } from "~/server/platform/database/types";

type RequestSessionRow = Selectable<PlatformDatabase["request_sessions"]>;
type NewRequestSessionRow = Insertable<PlatformDatabase["request_sessions"]>;

export function createRequestSessionsRepo(db: Kysely<PlatformDatabase>) {
  return {
    async create(session: NewRequestSessionRow): Promise<void> {
      await db.insertInto("request_sessions").values(session).execute();
    },

    async findById(id: string): Promise<RequestSessionRow | null> {
      const session = await db
        .selectFrom("request_sessions")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();

      return session ?? null;
    },

    async updateActivity(id: string, lastActivity: Date): Promise<void> {
      await db
        .updateTable("request_sessions")
        .set({ last_activity: lastActivity })
        .where("id", "=", id)
        .execute();
    },

    async nextExpiryAt(): Promise<Date | null> {
      const row = await db
        .selectFrom("request_sessions")
        .select("expires_at")
        .orderBy("expires_at")
        .limit(1)
        .executeTakeFirst();
      return row?.expires_at ?? null;
    },

    async deleteExpired(expiredBefore: Date): Promise<number> {
      const result = await db
        .deleteFrom("request_sessions")
        .where("expires_at", "<", expiredBefore)
        .executeTakeFirst();

      return Number(result.numDeletedRows ?? 0);
    },
  };
}
