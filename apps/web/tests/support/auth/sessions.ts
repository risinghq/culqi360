import type { SeededIdentityName } from "@tests/support/identities/api";
import { getSeededIdentity } from "@tests/support/identities/api";
import type { TestDbContext } from "@tests/support/runtime/db";

import { insertBatches } from "~/server/platform/database/batches";

export async function seedBulkSessions(
  ctx: TestDbContext,
  identityName: SeededIdentityName,
  count: number,
  now = new Date(),
): Promise<void> {
  const identity = getSeededIdentity(identityName);
  const sessions = Array.from({ length: count }, (_, index) => ({
    id: `bulk-${index}`,
    account_id: identity.userId,
    workspace_id: ctx.fixtures.workspace.id,
    impersonator_account_id: null,
    session_class: "app" as const,
    primary_auth_method: "password" as const,
    strong_auth_method: null,
    strong_auth_at: null,
    ip_address: null,
    user_agent: null,
    created_at: now,
    last_activity: now,
    expires_at: new Date(now.getTime() + 60_000),
  }));
  for (const batch of insertBatches(sessions)) {
    // eslint-disable-next-line no-await-in-loop
    await ctx.platform.insertInto("user_sessions").values(batch).execute();
  }
}
