import type {
  EventLogRecord,
  JsonObject,
} from "~/contracts/event-logs/event-log";
import { parseFieldChanges } from "~/contracts/events";
import type { Json } from "~/contracts/json";

function toProperties(value: Json | null): JsonObject {
  if (value === null) {
    return {};
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  return { value };
}

export function mapDomainEventRow(row: {
  id: string;
  entity_type: string;
  entity_id: string;
  type: string;
  actor_user_id: string | null;
  payload_json: Json | null;
  changes_json: Json | null;
  occurred_at: Date;
}): EventLogRecord {
  return {
    id: row.id,
    event: row.type,
    timestamp: row.occurred_at.getTime(),
    actorUserId: row.actor_user_id,
    entity: {
      type: row.entity_type,
      id: row.entity_id,
    },
    changes: parseFieldChanges(row.changes_json),
    properties: toProperties(row.payload_json),
  };
}
