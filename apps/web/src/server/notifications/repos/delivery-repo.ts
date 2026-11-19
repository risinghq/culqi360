import type { NotificationChannel } from "@crm/message-channels";
import type { Kysely } from "kysely";

import {
  NotificationDeliveryId,
  type NotificationIntentId,
  type UserId,
} from "~/domain/ids";
import { insertBatches } from "~/server/platform/database/batches";
import type { WorkspaceDatabase } from "~/server/platform/database/types";
import {
  createJobStore,
  type JobStore,
} from "~/server/platform/jobs/job-store";

export interface PlannedDeliveryRow {
  intent_id: NotificationIntentId;
  user_id: UserId;
  channel: NotificationChannel;
  recipient_address: string;
  title: string;
  body_text: string;
  action_url: string | null;
}

export interface DeliveryJob {
  id: NotificationDeliveryId;
  attempt_count: number;
  max_attempts: number;
  intent_id: NotificationIntentId;
  user_id: UserId;
  channel: NotificationChannel;
  recipient_address: string;
  title: string;
  body_text: string;
  action_url: string | null;
}

const DEFAULT_MAX_ATTEMPTS = 5;

export interface DeliveryRepository {
  store: JobStore<NotificationDeliveryId, DeliveryJob>;
  insertPlanned(rows: PlannedDeliveryRow[], plannedAt: Date): Promise<void>;
}

export function createDeliveryRepository(
  db: Kysely<WorkspaceDatabase>,
): DeliveryRepository {
  const store = createJobStore<DeliveryJob, NotificationDeliveryId>(
    db,
    "notification_deliveries",
    [
      "id",
      "attempt_count",
      "max_attempts",
      "intent_id",
      "user_id",
      "channel",
      "recipient_address",
      "title",
      "body_text",
      "action_url",
    ],
  );

  return {
    store,

    async insertPlanned(rows, plannedAt) {
      if (rows.length === 0) {
        return;
      }

      const planned = rows.map((row) => ({
        id: NotificationDeliveryId.mint(),
        intent_id: row.intent_id,
        user_id: row.user_id,
        channel: row.channel,
        recipient_address: row.recipient_address,
        title: row.title,
        body_text: row.body_text,
        action_url: row.action_url,
        queue_state: "pending" as const,
        attempt_count: 0,
        max_attempts: DEFAULT_MAX_ATTEMPTS,
        claimable_at: plannedAt,
        provider: null,
        provider_message_id: null,
        error_code: null,
        error_message: null,
        created_at: plannedAt,
        completed_at: null,
      }));
      for (const batch of insertBatches(planned)) {
        // eslint-disable-next-line no-await-in-loop
        await db
          .insertInto("notification_deliveries")
          .values(batch)
          .onConflict((conflict) =>
            conflict.columns(["intent_id", "user_id", "channel"]).doNothing(),
          )
          .execute();
      }
    },
  };
}
