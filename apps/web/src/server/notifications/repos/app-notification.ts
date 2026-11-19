import type { Insertable } from "kysely";

import type { AppNotificationId, UserId } from "~/domain/ids";
import { insertBatches } from "~/server/platform/database/batches";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { AppNotificationsTable } from "~/server/platform/database/types";

type NewAppNotificationRow = Insertable<AppNotificationsTable>;

export function createAppNotificationRepo(db: WorkspaceExecutor) {
  return {
    listByUser(userId: UserId, limit: number) {
      return db
        .selectFrom("app_notifications")
        .selectAll()
        .where("user_id", "=", userId)
        .orderBy("created_at", "desc")
        .limit(limit)
        .execute();
    },

    async countUnreadByUser(userId: UserId): Promise<number> {
      const row = await db
        .selectFrom("app_notifications")
        .select((eb) => eb.fn.count<number>("id").as("count"))
        .where("user_id", "=", userId)
        .where("read_at", "is", null)
        .executeTakeFirst();
      return row?.count ?? 0;
    },

    async createMany(values: NewAppNotificationRow[]): Promise<void> {
      for (const batch of insertBatches(values)) {
        // eslint-disable-next-line no-await-in-loop
        await db
          .insertInto("app_notifications")
          .values(batch)
          .onConflict((oc) => oc.columns(["user_id", "intent_id"]).doNothing())
          .execute();
      }
    },

    markRead(userId: UserId, notificationId: AppNotificationId, readAt: Date) {
      return db
        .updateTable("app_notifications")
        .set({ read_at: readAt })
        .where("id", "=", notificationId)
        .where("user_id", "=", userId)
        .where("read_at", "is", null)
        .execute();
    },

    markAllRead(userId: UserId, readAt: Date) {
      return db
        .updateTable("app_notifications")
        .set({ read_at: readAt })
        .where("user_id", "=", userId)
        .where("read_at", "is", null)
        .execute();
    },
  };
}

export type AppNotificationRepo = ReturnType<typeof createAppNotificationRepo>;
