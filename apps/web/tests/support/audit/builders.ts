import type { TestDbContext } from "@tests/support/runtime/db";

import type { UserId } from "~/domain/ids";
import { createEventsWriter } from "~/server/event-logs/events-repo";

export async function seedEvent(
  ctx: TestDbContext,
  input: {
    actorUserId: UserId;
    type: string;
    entityType: string;
    entityId: string;
    payload?: unknown;
    occurredAt: Date;
  },
): Promise<void> {
  await ctx.db.transaction().execute((tx) =>
    createEventsWriter(tx).append({
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      actorUserId: input.actorUserId,
      payload: input.payload,
      occurredAt: input.occurredAt,
    }),
  );
}
