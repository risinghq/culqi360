import type { Insertable, Selectable } from "kysely";

import type { UserId, WorkspaceId } from "~/domain/ids";
import type { PlatformExecutor } from "~/server/platform/database/executor";
import type { PlatformDatabase } from "~/server/platform/database/types";

export type UserSessionRow = Selectable<PlatformDatabase["user_sessions"]>;
type NewUserSessionRow = Insertable<PlatformDatabase["user_sessions"]>;

export interface ActiveWorkspaceSession {
  id: string;
  accountId: UserId;
  email: string;
  name: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastActivity: Date;
  expiresAt: Date;
}

export function createSessionRepository(db: PlatformExecutor) {
  return {
    db,

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

    async hasRecentForAccountAndIp(
      accountId: UserId,
      ipAddress: string,
      since: Date,
    ): Promise<boolean> {
      const session = await db
        .selectFrom("user_sessions")
        .select("id")
        .where("account_id", "=", accountId)
        .where("ip_address", "=", ipAddress)
        .where("created_at", ">=", since)
        .executeTakeFirst();
      return session !== undefined;
    },

    async updateActivity(id: string, lastActivity: Date): Promise<void> {
      await db
        .updateTable("user_sessions")
        .set({ last_activity: lastActivity })
        .where("id", "=", id)
        .execute();
    },

    async extendExpiry(id: string, expiresAt: Date): Promise<void> {
      await db
        .updateTable("user_sessions")
        .set({ expires_at: expiresAt })
        .where("id", "=", id)
        .execute();
    },

    async switchWorkspace(id: string, workspaceId: WorkspaceId): Promise<void> {
      await db
        .updateTable("user_sessions")
        .set({ workspace_id: workspaceId })
        .where("id", "=", id)
        .execute();
    },

    async delete(id: string): Promise<void> {
      await db.deleteFrom("user_sessions").where("id", "=", id).execute();
    },

    async deleteAllForAccount(accountId: UserId): Promise<void> {
      await db
        .deleteFrom("user_sessions")
        .where("account_id", "=", accountId)
        .execute();
    },

    async deleteAllForMember(
      accountId: UserId,
      workspaceId: WorkspaceId,
    ): Promise<void> {
      await db
        .deleteFrom("user_sessions")
        .where("account_id", "=", accountId)
        .where("workspace_id", "=", workspaceId)
        .execute();
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

    async listForAccount(accountId: UserId): Promise<UserSessionRow[]> {
      return db
        .selectFrom("user_sessions")
        .selectAll()
        .where("account_id", "=", accountId)
        .orderBy("last_activity", "desc")
        .execute();
    },

    async countActiveInWorkspace(
      workspaceId: WorkspaceId,
      activeAsOf: Date,
    ): Promise<number> {
      const result = await db
        .selectFrom("user_sessions")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("workspace_id", "=", workspaceId)
        .where("expires_at", ">", activeAsOf)
        .executeTakeFirstOrThrow();

      return result.count;
    },

    // Role and branch live in the workspace store; the caller adds them.
    async listActiveInWorkspace(
      workspaceId: WorkspaceId,
      activeAsOf: Date,
    ): Promise<ActiveWorkspaceSession[]> {
      const sessions = await db
        .selectFrom("user_sessions")
        .innerJoin("accounts", "accounts.id", "user_sessions.account_id")
        .select([
          "user_sessions.id",
          "user_sessions.account_id",
          "accounts.email",
          "accounts.names",
          "accounts.first_surname",
          "user_sessions.ip_address",
          "user_sessions.user_agent",
          "user_sessions.created_at",
          "user_sessions.last_activity",
          "user_sessions.expires_at",
        ])
        .where("user_sessions.workspace_id", "=", workspaceId)
        .where("user_sessions.expires_at", ">", activeAsOf)
        .orderBy("user_sessions.last_activity", "desc")
        .execute();

      return sessions.map((session) => ({
        id: session.id,
        accountId: session.account_id,
        email: session.email,
        name: `${session.names} ${session.first_surname}`,
        ipAddress: session.ip_address,
        userAgent: session.user_agent,
        createdAt: session.created_at,
        lastActivity: session.last_activity,
        expiresAt: session.expires_at,
      }));
    },
  };
}

export type SessionRepository = ReturnType<typeof createSessionRepository>;
