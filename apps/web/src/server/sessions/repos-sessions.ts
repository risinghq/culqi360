import type { Insertable, Selectable } from "kysely";

import type { UserId } from "~/domain/ids";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { WorkspaceDatabase } from "~/server/platform/database/types";

export type UserSessionRow = Selectable<WorkspaceDatabase["user_sessions"]>;
export type NewUserSessionRow = Omit<
  Insertable<WorkspaceDatabase["user_sessions"]>,
  "user_id"
> & { user_id: UserId };

export function createSessionRepository(db: WorkspaceExecutor) {
  return {
    async create(session: NewUserSessionRow): Promise<void> {
      await db.insertInto("user_sessions").values(session).execute();
    },

    async findById(id: string): Promise<UserSessionRow | null> {
      const session = await db
        .selectFrom("user_sessions")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return session ?? null;
    },

    async hasRecentFromIp(
      userId: UserId,
      ipAddress: string,
      since: Date,
    ): Promise<boolean> {
      const session = await db
        .selectFrom("user_sessions")
        .select("id")
        .where("user_id", "=", userId)
        .where("ip_address", "=", ipAddress)
        .where("created_at", ">=", since)
        .executeTakeFirst();
      return session !== undefined;
    },

    async touch(
      id: string,
      changes: { last_activity?: Date; expires_at?: Date },
    ): Promise<void> {
      await db
        .updateTable("user_sessions")
        .set(changes)
        .where("id", "=", id)
        .execute();
    },

    async delete(id: string): Promise<void> {
      await db.deleteFrom("user_sessions").where("id", "=", id).execute();
    },

    // Scoped to the user, so a caller naming another user's session id
    // deletes nothing.
    async deleteForUser(userId: UserId, id?: string): Promise<void> {
      let query = db.deleteFrom("user_sessions").where("user_id", "=", userId);
      if (id !== undefined) {
        query = query.where("id", "=", id);
      }
      await query.execute();
    },

    async nextExpiryAt(): Promise<Date | null> {
      const row = await db
        .selectFrom("user_sessions")
        .select("expires_at")
        .orderBy("expires_at")
        .limit(1)
        .executeTakeFirst();
      return row?.expires_at ?? null;
    },

    async deleteExpired(expiredBefore: Date): Promise<number> {
      const result = await db
        .deleteFrom("user_sessions")
        .where("expires_at", "<", expiredBefore)
        .executeTakeFirst();
      return Number(result.numDeletedRows ?? 0);
    },
  };
}

export type SessionRepository = ReturnType<typeof createSessionRepository>;
