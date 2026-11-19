import type { SeededIdentityName } from "@tests/support/identities/api";
import { getSeededIdentity } from "@tests/support/identities/api";
import type { TestDbContext } from "@tests/support/runtime/db";

import type { UserId } from "~/domain/ids";
import { insertBatches } from "~/server/platform/database/batches";
import type { UserSessionRow } from "~/server/sessions/repos-sessions";

// The fixture workspace's sessions for one user, oldest first.
export function sessionsOf(
  ctx: TestDbContext,
  userId: UserId,
): Promise<UserSessionRow[]> {
  return ctx.db
    .selectFrom("user_sessions")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("created_at")
    .execute();
}

export async function seedBulkSessions(
  ctx: TestDbContext,
  identityName: SeededIdentityName,
  count: number,
  now = new Date(),
): Promise<void> {
  const identity = getSeededIdentity(identityName);
  const sessions = Array.from({ length: count }, (_, index) => ({
    id: `bulk-${index}`,
    user_id: identity.userId,
    impersonator_user_id: null,
    session_class: "app" as const,
    primary_auth_method: "password" as const,
    strong_auth_method: null,
    strong_auth_at: null,
    ip_address: "127.0.0.1",
    user_agent: null,
    created_at: now,
    last_activity: now,
    expires_at: new Date(now.getTime() + 60_000),
  }));
  for (const batch of insertBatches(sessions)) {
    // eslint-disable-next-line no-await-in-loop
    await ctx.db.insertInto("user_sessions").values(batch).execute();
  }
}
