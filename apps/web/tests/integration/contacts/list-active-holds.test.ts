import { operationAt } from "@tests/support/operation";
import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  TEST_FIXTURES,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createContactHoldsRuntime } from "~/server/contacts/runtime";
import { Ok } from "~/shared/result";

const ACTOR_ID = TEST_FIXTURES.users.execOne.id;
const OTHER_USER_ID = TEST_FIXTURES.users.execTwo.id;
const NOW = new Date("2026-08-07T17:00:00.000Z");
const HOUR_MS = 3_600_000;

describe("listActive", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("list-active-holds");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  function runtime() {
    return createContactHoldsRuntime({
      executor: ctx.db,
      engine: { requestCandidates: async () => Ok([]) },
    });
  }

  async function holdFor(
    userId: typeof ACTOR_ID,
    expiresAt: Date,
  ): Promise<string> {
    const id = crypto.randomUUID();
    await ctx.db
      .insertInto("contact_holds")
      .values({
        id,
        user_id: userId,
        contact_id: TEST_FIXTURES.contacts.lima.id,
        held_at: new Date(NOW.getTime() - HOUR_MS),
        expires_at: expiresAt,
        status: "active",
      })
      .execute();
    return id;
  }

  it("lists only the actor's unexpired holds with the contact's name and phone", async () => {
    const mine = await holdFor(ACTOR_ID, new Date(NOW.getTime() + HOUR_MS));
    await holdFor(ACTOR_ID, new Date(NOW.getTime() - 1));
    await holdFor(OTHER_USER_ID, new Date(NOW.getTime() + HOUR_MS));

    const result = await runtime().listActive(ACTOR_ID, operationAt(NOW));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      holdId: mine,
      contactId: TEST_FIXTURES.contacts.lima.id,
      expiresAt: NOW.getTime() + HOUR_MS,
    });
    expect(result.value[0]?.name).not.toBe("");
  });
});
