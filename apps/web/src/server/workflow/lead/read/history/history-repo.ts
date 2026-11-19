import type { DomainError } from "~/domain/errors";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import {
  isLeadHistoryEventType,
  type LeadHistoryEntry,
} from "~/server/workflow/lead/domain/history";
import { unknownLeadEventType } from "~/server/workflow/lead/domain/integrity-errors";
import { Err, Ok, type Result } from "~/shared/result";

import { toHistoryEntry } from "./history-entry-parser";

export type LeadHistoryRepository = {
  listByLeadId(
    leadId: string,
  ): Promise<Result<LeadHistoryEntry[], DomainError>>;
};

export function createHistoryRepo(
  db: WorkspaceExecutor,
): LeadHistoryRepository {
  return {
    async listByLeadId(
      leadId: string,
    ): Promise<Result<LeadHistoryEntry[], DomainError>> {
      const rows = await db
        .selectFrom("events as event")
        .leftJoin("members as actor", "actor.user_id", "event.actor_user_id")
        .leftJoin(
          "members as subject",
          "subject.user_id",
          "event.subject_user_id",
        )
        .select([
          "event.id",
          "event.entity_id as lead_id",
          "event.type as event_type",
          "event.actor_user_id",
          "event.subject_user_id",
          "event.payload_json",
          "event.changes_json",
          "event.occurred_at",
          "actor.names as actor_names",
          "actor.first_surname as actor_first_surname",
          "actor.second_surname as actor_second_surname",
          "subject.names as subject_names",
          "subject.first_surname as subject_first_surname",
          "subject.second_surname as subject_second_surname",
        ])
        .where("event.entity_type", "=", "lead")
        .where("event.entity_id", "=", leadId)
        .orderBy("event.occurred_at", "desc")
        .execute();

      const entries: LeadHistoryEntry[] = [];

      for (const row of rows) {
        const eventType = row.event_type;

        if (!isLeadHistoryEventType(eventType)) {
          return unknownLeadEventType({
            id: row.id,
            type: eventType,
          });
        }

        const entry = toHistoryEntry({
          ...row,
          event_type: eventType,
        });

        if (!entry.ok) {
          return Err(entry.error);
        }

        entries.push(entry.value);
      }

      return Ok(entries);
    },
  };
}
