import { serializeEventPayload } from "~/contracts/events";
import { EventId, type UserId, type WorkspaceId } from "~/domain/ids";
import type { PlatformExecutor } from "~/server/platform/database/executor";

export type PlatformEventToAppend = {
  workspaceId?: WorkspaceId | null;
  entityType: string;
  entityId: string;
  type: string;
  actorUserId?: UserId | null;
  subjectUserId?: UserId | null;
  payload?: unknown;
  occurredAt: Date;
};

// Platform events notify nobody: a change that someone in a workspace must
// hear about goes to that workspace's events through its port.
export function createPlatformEventsWriter(db: PlatformExecutor) {
  return {
    async append(event: PlatformEventToAppend): Promise<EventId> {
      const id = EventId.mint();
      await db
        .insertInto("platform_events")
        .values({
          id,
          workspace_id: event.workspaceId ?? null,
          entity_type: event.entityType,
          entity_id: event.entityId,
          type: event.type,
          actor_account_id: event.actorUserId ?? null,
          subject_account_id: event.subjectUserId ?? null,
          payload_json: serializeEventPayload(event.payload),
          occurred_at: event.occurredAt,
        })
        .execute();
      return id;
    },
  };
}

export type PlatformEventsWriter = ReturnType<
  typeof createPlatformEventsWriter
>;
