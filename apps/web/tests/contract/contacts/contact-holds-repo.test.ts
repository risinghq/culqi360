import { createContactHoldsTestKit } from "@tests/support/contacts/kit";
import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("contact hold repository", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("contact-holds");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  it("returns only active and non-expired holds", async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);
    const expiredAt = new Date(now.getTime() - 1);
    const { execOne } = ctx.fixtures.users;
    const { lima, norte } = ctx.fixtures.contacts;
    const contacts = createContactHoldsTestKit(ctx);
    await contacts.seedHolds([
      {
        userId: execOne.id,
        contactId: lima.id,
        heldAt: now,
        expiresAt,
        status: "active",
      },
      {
        userId: execOne.id,
        contactId: norte.id,
        heldAt: now,
        expiresAt: expiredAt,
        status: "active",
      },
      {
        userId: execOne.id,
        contactId: norte.id,
        heldAt: now,
        expiresAt,
        status: "completed",
      },
    ]);

    const activeContactIds = await contacts.activeContactIdsForUser(execOne.id);
    expect(activeContactIds).toEqual([lima.id]);
  });

  it("hasActiveForContact respects expiry and ownership", async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);
    const { execOne, execTwo } = ctx.fixtures.users;
    const { lima, norte } = ctx.fixtures.contacts;
    const contacts = createContactHoldsTestKit(ctx);
    await contacts.seedHolds([
      {
        userId: execOne.id,
        contactId: lima.id,
        heldAt: now,
        expiresAt,
        status: "active",
      },
      {
        userId: execTwo.id,
        contactId: norte.id,
        heldAt: now,
        expiresAt,
        status: "active",
      },
    ]);

    expect(await contacts.hasActiveHold(execOne.id, lima.id)).toBe(true);
    expect(await contacts.hasActiveHold(execOne.id, norte.id)).toBe(false);
    expect(await contacts.hasActiveHold(execTwo.id, norte.id)).toBe(true);
  });
});
