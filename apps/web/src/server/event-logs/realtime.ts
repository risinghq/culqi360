import { sql, type Kysely } from "kysely";

import {
  decodeEventLogCursor,
  encodeEventLogCursor,
  EVENT_LOG_TOPIC,
  parseEventLogRecordText,
  type EventLogRecord,
} from "~/contracts/event-logs/event-log";
import {
  REALTIME_CHANNELS,
  type RealtimeMessage,
} from "~/contracts/realtime/channel";
import { hasPermission } from "~/domain/auth/access/rbac";
import type { CommitEffects } from "~/server/platform/database/commit-effects";
import type { WorkspaceDatabase } from "~/server/platform/database/types";
import { defineRealtimeChannel } from "~/server/realtime/channel";
import type { RealtimeService } from "~/server/realtime/runtime";
import { createLogger } from "~/shared/observability/runtime-logger";

import { mapDomainEventRow } from "./mappers";
import type { createEventLogsService } from "./service";

const REPLAY_LIMIT = 200;
const TAIL_BATCH = 200;

const logger = createLogger("event-logs-tail");

function recordCursor(record: EventLogRecord): string {
  return encodeEventLogCursor({
    timestamp: record.timestamp,
    id: record.id,
  });
}

function toMessage(record: EventLogRecord): RealtimeMessage {
  return {
    id: recordCursor(record),
    data: JSON.stringify(record),
  };
}

export function createEventLogsChannel(
  eventLogs: Pick<ReturnType<typeof createEventLogsService>, "replayAfter">,
) {
  return defineRealtimeChannel({
    name: REALTIME_CHANNELS.eventLogs,

    parseId: (raw) => (raw === EVENT_LOG_TOPIC ? raw : null),

    open: async (session, _topic, cursor) => {
      if (!hasPermission(session, "audit:read")) {
        return null;
      }

      const decoded = cursor === null ? null : decodeEventLogCursor(cursor);

      // The initial page comes from the regular query; only reconnect gaps replay.
      if (!decoded) {
        return [];
      }

      const missed = await eventLogs.replayAfter(decoded, REPLAY_LIMIT);

      return missed.map(toMessage);
    },

    topicIdOfPayload: (payload) =>
      parseEventLogRecordText(payload).ok ? EVENT_LOG_TOPIC : null,

    cursorOf: (payload) => {
      const record = parseEventLogRecordText(payload);

      return record.ok ? recordCursor(record.value) : undefined;
    },
  });
}

/**
 * Streams every committed event row to live viewers.
 *
 * It reads what the store appended after each commit, so no writer has to
 * announce its events. The rowid follows insertion order, which an event's
 * occurred_at does not.
 */
export function startEventLogsTail(input: {
  db: Kysely<WorkspaceDatabase>;
  effects: CommitEffects;
  realtime: Pick<RealtimeService, "isWatched" | "publish">;
}): () => void {
  const { db, realtime } = input;
  let lastSeq = latestSeq();
  // A failed first read surfaces in the first catch-up, which logs it.
  lastSeq.catch(() => undefined);
  let chain: Promise<void> = Promise.resolve();

  function latestSeq(): Promise<number> {
    return sql<{ seq: number | null }>`select max(rowid) as seq from events`
      .execute(db)
      .then((result) => result.rows[0]?.seq ?? 0);
  }

  async function catchUp(): Promise<void> {
    if (!realtime.isWatched(REALTIME_CHANNELS.eventLogs, EVENT_LOG_TOPIC)) {
      lastSeq = latestSeq();
      return;
    }

    let after = await lastSeq;

    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await db
        .selectFrom("events")
        .select(sql<number>`rowid`.as("seq"))
        .selectAll()
        .where(sql<boolean>`rowid > ${after}`)
        .orderBy(sql`rowid`)
        .limit(TAIL_BATCH)
        .execute();

      for (const row of rows) {
        realtime.publish(
          db,
          REALTIME_CHANNELS.eventLogs,
          JSON.stringify(mapDomainEventRow(row)),
        );
        after = row.seq;
      }

      lastSeq = Promise.resolve(after);

      if (rows.length < TAIL_BATCH) {
        return;
      }
    }
  }

  // Catch-ups run one at a time, so rows reach viewers in insertion order.
  return input.effects.onCommit(() => {
    chain = chain.then(catchUp).catch((error: unknown) => {
      logger.error("event_logs_tail_failed", { error: String(error) });
    });
  });
}
