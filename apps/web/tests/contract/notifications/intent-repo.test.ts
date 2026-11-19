import {
  anIntentRow,
  notificationIntentId,
} from "@tests/support/builders/notifications";
import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createIntentRepository } from "~/server/notifications/repos/intent-repo";

const NOW = new Date(1_700_000_000_000);
const RETRY_AT = new Date(NOW.getTime() + 5_000);
const FIRST_ATTEMPT = 1;

describe("intent repository", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("intent-repo");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  async function seedPending(id: string) {
    await ctx.db
      .insertInto("notification_intents")
      .values(anIntentRow({ id, now: NOW }))
      .execute();
  }

  it("leases a pending intent and increments the attempt", async () => {
    await seedPending("intent-1");
    const repository = createIntentRepository(ctx.db);

    const leased = await repository.store.claim(NOW, 10, 30_000);

    expect(leased).toMatchObject([
      { id: "intent-1", attempt_count: 1, max_attempts: 5 },
    ]);

    const row = await ctx.db
      .selectFrom("notification_intents")
      .select(["queue_state", "claimable_at"])
      .where("id", "=", notificationIntentId("intent-1"))
      .executeTakeFirstOrThrow();

    // While processing, claimable_at holds the lease expiration.
    expect(row).toEqual({
      queue_state: "processing",
      claimable_at: new Date(NOW.getTime() + 30_000),
    });
  });

  it("does not hand the same intent out twice while leased", async () => {
    await seedPending("intent-1");
    const repository = createIntentRepository(ctx.db);

    await repository.store.claim(NOW, 10, 30_000);
    const second = await repository.store.claim(NOW, 10, 30_000);

    expect(second).toEqual([]);
  });

  it("marks an intent done", async () => {
    await seedPending("intent-1");
    const repository = createIntentRepository(ctx.db);

    await repository.store.claim(NOW, 10, 30_000);

    await repository.store.markDone(
      notificationIntentId("intent-1"),
      FIRST_ATTEMPT,
      NOW,
    );

    const row = await ctx.db
      .selectFrom("notification_intents")
      .select(["queue_state", "completed_at", "error_message"])
      .where("id", "=", notificationIntentId("intent-1"))
      .executeTakeFirstOrThrow();

    expect(row).toEqual({
      queue_state: "done",
      completed_at: NOW,
      error_message: null,
    });
  });

  it("schedules retries and records terminal failures", async () => {
    await seedPending("intent-retry");
    await seedPending("intent-fail");
    const repository = createIntentRepository(ctx.db);

    await repository.store.claim(NOW, 10, 30_000);

    await repository.store.scheduleRetry(
      notificationIntentId("intent-retry"),
      FIRST_ATTEMPT,
      RETRY_AT,
      null,
    );

    await repository.store.markFailed(
      notificationIntentId("intent-fail"),
      FIRST_ATTEMPT,
      NOW,
      "boom",
    );

    const rows = await ctx.db
      .selectFrom("notification_intents")
      .select(["id", "queue_state", "error_message"])
      .orderBy("id", "asc")
      .execute();

    expect(rows).toEqual([
      { id: "intent-fail", queue_state: "failed", error_message: "boom" },
      { id: "intent-retry", queue_state: "pending", error_message: null },
    ]);

    const retry = await ctx.db
      .selectFrom("notification_intents")
      .select("claimable_at")
      .where("id", "=", notificationIntentId("intent-retry"))
      .executeTakeFirstOrThrow();

    expect(retry.claimable_at).toEqual(RETRY_AT);
  });

  it("rejects a settle from a holder whose attempt was reclaimed", async () => {
    await seedPending("intent-1");
    const repository = createIntentRepository(ctx.db);

    await repository.store.claim(NOW, 1, 30_000);
    const [reclaimed] = await repository.store.claim(
      new Date(NOW.getTime() + 30_001),
      1,
      30_000,
    );

    expect(reclaimed?.attempt_count).toBe(2);
    expect(
      await repository.store.markDone(
        notificationIntentId("intent-1"),
        FIRST_ATTEMPT,
        NOW,
      ),
    ).toBe(false);
  });

  it("counts pending and processing intents as outstanding", async () => {
    await seedPending("intent-1");
    await seedPending("intent-2");
    const repository = createIntentRepository(ctx.db);

    await repository.store.claim(NOW, 1, 30_000);

    expect(await repository.store.countOutstanding()).toBe(2);

    await repository.store.markDone(
      notificationIntentId("intent-1"),
      FIRST_ATTEMPT,
      NOW,
    );

    expect(await repository.store.countOutstanding()).toBe(1);
  });
});
