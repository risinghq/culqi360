import type { Insertable, Transaction } from "kysely";

import {
  serializeEventPayload,
  serializeFieldChanges,
  type FieldChange,
} from "~/contracts/events";
import { EventId, type UserId } from "~/domain/ids";
import { enqueueNotifications } from "~/server/notifications/intent/enqueue";
import { NOTIFICATION_EVENT_POLICIES } from "~/server/notifications/policy/registry";
import { insertBatches } from "~/server/platform/database/batches";
import type { WorkspaceDatabase } from "~/server/platform/database/types";

export type EventToAppend = {
  entityType: string;
  entityId: string;
  type: string;
  actorUserId?: UserId | null;
  subjectUserId?: UserId | null;
  payload?: unknown;
  changes?: FieldChange[];
  occurredAt: Date;

  // Used by notification policies only; never persisted in the event payload.
  notificationContext?: unknown;
};

type NewEventRow = Required<Insertable<WorkspaceDatabase["events"]>> & {
  id: EventId;
};

function toNewEventRow(event: EventToAppend): NewEventRow {
  return {
    id: EventId.mint(),
    entity_type: event.entityType,
    entity_id: event.entityId,
    type: event.type,
    actor_user_id: event.actorUserId ?? null,
    subject_user_id: event.subjectUserId ?? null,
    payload_json: serializeEventPayload(event.payload),
    changes_json: event.changes ? serializeFieldChanges(event.changes) : null,
    occurred_at: event.occurredAt,
  };
}

// Events and their notification intents share one transaction. The live
// event-log stream reads committed rows itself, so appending announces nothing.
async function appendEvents(
  tx: Transaction<WorkspaceDatabase>,
  input: EventToAppend | EventToAppend[],
): Promise<EventId[]> {
  const events = Array.isArray(input) ? input : [input];

  if (events.length === 0) {
    return [];
  }

  const rows = events.map(toNewEventRow);
  for (const batch of insertBatches(rows)) {
    // eslint-disable-next-line no-await-in-loop
    await tx.insertInto("events").values(batch).execute();
  }

  const intents = rows.flatMap((row, index) => {
    const event = events[index];
    const intent = event
      ? NOTIFICATION_EVENT_POLICIES[row.type]?.buildIntent({
          eventId: row.id,
          entityId: row.entity_id,
          actorUserId: event.actorUserId ?? null,
          subjectUserId: event.subjectUserId ?? null,
          occurredAt: event.occurredAt,
          payload: event.payload,
          notificationContext: event.notificationContext ?? null,
        })
      : undefined;

    return intent ? [{ intent, occurredAt: row.occurred_at }] : [];
  });

  const byOccurredAt = Map.groupBy(intents, ({ occurredAt }) =>
    occurredAt.getTime(),
  );
  for (const [occurredAt, group] of byOccurredAt) {
    // eslint-disable-next-line no-await-in-loop
    await enqueueNotifications(
      tx,
      group.map(({ intent }) => intent),
      new Date(occurredAt),
    );
  }

  return rows.map((row) => row.id);
}

export function createEventsWriter(tx: Transaction<WorkspaceDatabase>) {
  return {
    append(input: EventToAppend | EventToAppend[]): Promise<EventId[]> {
      return appendEvents(tx, input);
    },
  };
}

export type EventsWriter = {
  append(input: EventToAppend | EventToAppend[]): Promise<EventId[]>;
};
