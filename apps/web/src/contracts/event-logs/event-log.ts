import { isFieldChange, type FieldChange } from "~/contracts/events";
import type { Json } from "~/contracts/json";
import type { CalendarDate } from "~/domain/time/calendar-date";

export type JsonObject = { [key: string]: Json };

/** A workspace has one event stream, so its live feed has one topic. */
export const EVENT_LOG_TOPIC = "workspace";

export type EventLogRecord = {
  id: string;
  event: string;
  timestamp: number;
  actorUserId: string | null;
  entity: {
    type: string;
    id: string;
  };
  changes: FieldChange[];
  properties: JsonObject;
};

export interface EventLogPageInfo {
  endCursor: string | null;
  hasNextPage: boolean;
}

export interface EventLogQueryResult {
  records: EventLogRecord[];
  totalCount: number;
  pageInfo: EventLogPageInfo;
}

export interface EventLogFilters {
  eventType?: string;
  actorUserId?: string;
  onlyHighRisk?: boolean;
  dateRange?: {
    start?: CalendarDate;
    end?: CalendarDate;
  };
}

export interface EventLogQueryInput {
  filters?: EventLogFilters;
  first?: number;
  after?: string | null;
}

export interface EventLogCursor {
  timestamp: number;
  id: string;
}

export type EventLogParseResult =
  | { ok: true; value: EventLogRecord }
  | { ok: false; error: { message: string } };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJson(value: unknown): value is Json {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJson);
  }

  if (!isObject(value)) {
    return false;
  }

  return Object.values(value).every(isJson);
}

function isJsonObject(value: unknown): value is JsonObject {
  return isObject(value) && Object.values(value).every(isJson);
}

function parseEventLogRecord(value: unknown): EventLogParseResult {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.event !== "string" ||
    typeof value.timestamp !== "number" ||
    !Number.isFinite(value.timestamp) ||
    !isJsonObject(value.properties)
  ) {
    return {
      ok: false,
      error: { message: "Event log record has an invalid base shape" },
    };
  }

  const { actorUserId, entity, changes } = value;

  if (
    (actorUserId !== null && typeof actorUserId !== "string") ||
    !isObject(entity) ||
    typeof entity.type !== "string" ||
    typeof entity.id !== "string" ||
    !Array.isArray(changes) ||
    !changes.every(isFieldChange)
  ) {
    return {
      ok: false,
      error: {
        message: "Event log record has an invalid actor, entity or changes",
      },
    };
  }

  return {
    ok: true,
    value: {
      id: value.id,
      event: value.event,
      timestamp: value.timestamp,
      actorUserId,
      entity: { type: entity.type, id: entity.id },
      changes,
      properties: value.properties,
    },
  };
}

export function parseEventLogRecordText(raw: string): EventLogParseResult {
  try {
    return parseEventLogRecord(JSON.parse(raw));
  } catch {
    return {
      ok: false,
      error: { message: "Event log payload is not valid JSON" },
    };
  }
}

export function encodeEventLogCursor(cursor: EventLogCursor): string {
  return btoa(`${cursor.timestamp}:${cursor.id}`);
}

export function decodeEventLogCursor(raw: string): EventLogCursor | null {
  try {
    const decoded = atob(raw);
    const separator = decoded.indexOf(":");

    if (separator < 0) {
      return null;
    }

    const timestamp = Number(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);

    if (!Number.isFinite(timestamp) || id.length === 0) {
      return null;
    }

    return { timestamp, id };
  } catch {
    return null;
  }
}
