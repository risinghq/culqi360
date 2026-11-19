import type { Kysely } from "kysely";

import {
  decodeEventLogCursor,
  encodeEventLogCursor,
  type EventLogCursor,
  type EventLogFilters,
  type EventLogQueryInput,
  type EventLogQueryResult,
  type EventLogRecord,
} from "~/contracts/event-logs/event-log";
import { invalid, type DomainError } from "~/domain/errors";
import { EventId, UserId } from "~/domain/ids";
import { appDayRange } from "~/domain/time/app-time";
import { parsePositiveIntegerAtMost } from "~/server/platform/action/query-window";
import type { WorkspaceDatabase } from "~/server/platform/database/types";
import { Err, isErr, Ok, type Result } from "~/shared/result";

import { mapDomainEventRow } from "./mappers";

const DEFAULT_FIRST = 100;
const MAX_FIRST = 200;

function buildPage(
  records: EventLogRecord[],
  totalCount: number,
  first: number,
): EventLogQueryResult {
  const hasNextPage = records.length > first;
  const page = hasNextPage ? records.slice(0, first) : records;
  const last = page.at(-1);
  return {
    records: page,
    totalCount,
    pageInfo: {
      hasNextPage,
      endCursor: last
        ? encodeEventLogCursor({ timestamp: last.timestamp, id: last.id })
        : null,
    },
  };
}

export function createEventLogsService(db: Kysely<WorkspaceDatabase>) {
  function filtered(filters: EventLogFilters | undefined) {
    const range = filters?.dateRange;
    const eventType = filters?.eventType?.trim();
    const actorUserId = filters?.actorUserId?.trim();

    let query = db
      .selectFrom("events")
      .leftJoin(
        "audit_action_policies as policy",
        "policy.action",
        "events.type",
      );

    if (range?.start) {
      query = query.where(
        "events.occurred_at",
        ">=",
        appDayRange(range.start).start,
      );
    }
    if (range?.end) {
      query = query.where(
        "events.occurred_at",
        "<",
        appDayRange(range.end).endExclusive,
      );
    }
    if (eventType) {
      // SQLite's like ignores ASCII case, which is what this filter wants.
      query = query.where("events.type", "like", `%${eventType}%`);
    }
    if (actorUserId) {
      query = query.where(
        "events.actor_user_id",
        "=",
        UserId.trust(actorUserId),
      );
    }
    if (filters?.onlyHighRisk === true) {
      query = query.where((eb) =>
        eb.or([
          eb("policy.action", "is", null),
          eb.and([
            eb("policy.risk_level", "=", "high"),
            eb("policy.is_active", "=", true),
          ]),
        ]),
      );
    }

    return query;
  }

  async function queryPage(
    filters: EventLogFilters | undefined,
    cursor: EventLogCursor | null,
    first: number,
  ): Promise<EventLogQueryResult> {
    const base = filtered(filters);
    let page = base.selectAll("events");

    if (cursor) {
      const cursorDate = new Date(cursor.timestamp);
      page = page.where((eb) =>
        eb.or([
          eb("events.occurred_at", "<", cursorDate),
          eb.and([
            eb("events.occurred_at", "=", cursorDate),
            eb("events.id", "<", EventId.trust(cursor.id)),
          ]),
        ]),
      );
    }

    const rows = await page
      .orderBy("events.occurred_at", "desc")
      .orderBy("events.id", "desc")
      .limit(first + 1)
      .execute();
    const countRow = await base
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirst();

    return buildPage(rows.map(mapDomainEventRow), countRow?.count ?? 0, first);
  }

  // Ascending catch-up from a cursor, unfiltered: the live stream only runs
  // while no filters are active, so replay never needs to consider them.
  async function replayAfter(
    cursor: EventLogCursor,
    limit: number,
  ): Promise<EventLogRecord[]> {
    const cursorDate = new Date(cursor.timestamp);
    const rows = await db
      .selectFrom("events")
      .selectAll()
      .where((eb) =>
        eb.or([
          eb("occurred_at", ">", cursorDate),
          eb.and([
            eb("occurred_at", "=", cursorDate),
            eb("id", ">", EventId.trust(cursor.id)),
          ]),
        ]),
      )
      .orderBy("occurred_at", "asc")
      .orderBy("id", "asc")
      .limit(limit)
      .execute();
    return rows.map(mapDomainEventRow);
  }

  return {
    replayAfter,

    async getEventLogs(
      input: EventLogQueryInput,
    ): Promise<Result<EventLogQueryResult, DomainError>> {
      const parsedFirst = parsePositiveIntegerAtMost(
        input.first ?? DEFAULT_FIRST,
        { code: "invalid_first", field: "first", max: MAX_FIRST },
      );
      if (isErr(parsedFirst)) {
        return parsedFirst;
      }

      const cursor = input.after ? decodeEventLogCursor(input.after) : null;
      if (input.after && !cursor) {
        return Err(invalid({ code: "invalid_cursor" }));
      }

      return Ok(await queryPage(input.filters, cursor, parsedFirst.value));
    },
  };
}
