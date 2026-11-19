import { insertBatches } from "~/server/platform/database/batches";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";

import type { NotificationIntent } from "../types";
import { validateNotificationIntent } from "./payload";

const DEFAULT_MAX_ATTEMPTS = 5;

export async function enqueueNotifications(
  db: WorkspaceExecutor,
  intents: readonly unknown[],
  enqueuedAt: Date,
): Promise<void> {
  if (intents.length === 0) {
    return;
  }

  // Validate every intent at the producer boundary.
  const validated: NotificationIntent[] = intents.map((intent) =>
    validateNotificationIntent(intent),
  );

  const rows = validated.map((intent) => ({
    id: intent.id,
    event_type: intent.eventType,
    audience_json: intent.audience,
    channels_json: intent.channels,
    title: intent.title,
    body_text: intent.bodyText,
    action_url: intent.actionUrl,
    priority: intent.priority,
    queue_state: "pending" as const,
    attempt_count: 0,
    max_attempts: DEFAULT_MAX_ATTEMPTS,
    claimable_at: enqueuedAt,
    error_message: null,
    created_at: enqueuedAt,
    completed_at: null,
  }));
  for (const batch of insertBatches(rows)) {
    // eslint-disable-next-line no-await-in-loop
    await db
      .insertInto("notification_intents")
      .values(batch)
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
  }
}
