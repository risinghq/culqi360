import { expectOk } from "@tests/support/_core/assertions";
import { createContactHoldsTestKit } from "@tests/support/contacts/kit";
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

const EXEC = TEST_FIXTURES.users.execOne;
const CONTACT = TEST_FIXTURES.contacts.lima;
const ORG = TEST_FIXTURES.organizations.lima;
const HELD_AT = new Date("2026-08-07T15:00:00.000Z");
const COMPLETED_AT = new Date("2026-08-07T15:20:00.000Z");

describe("completing a contact hold", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("complete-hold-call");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  async function seedHold() {
    await createContactHoldsTestKit(ctx).seedHolds([
      {
        userId: EXEC.id,
        contactId: CONTACT.id,
        heldAt: HELD_AT,
        expiresAt: new Date(HELD_AT.getTime() + 24 * 60 * 60_000),
        status: "active",
      },
    ]);
    const row = await ctx.db
      .selectFrom("contact_holds")
      .select("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  function complete(holdId: Awaited<ReturnType<typeof seedHold>>) {
    const runtime = createContactHoldsRuntime({
      executor: ctx.db,
      engine: { requestCandidates: async () => Ok([]) },
    });
    return runtime.completeCall(
      {
        actorUserId: EXEC.id,
        branchId: EXEC.branchId,
        holdId,
        contactId: CONTACT.id,
        outcome: "callback_scheduled",
        notes: "Volver a llamar el lunes",
      },
      operationAt(COMPLETED_AT),
    );
  }

  function callsOnContact() {
    return ctx.db
      .selectFrom("calls")
      .select(["id", "source", "outcome", "notes", "ended_at"])
      .where("contact_id", "=", CONTACT.id)
      .execute();
  }

  it("records a manual call when the executive dialed outside the extension", async () => {
    const holdId = await seedHold();

    expectOk(await complete(holdId));

    expect(await callsOnContact()).toEqual([
      {
        id: expect.any(String),
        source: "manual",
        outcome: "callback_scheduled",
        notes: "Volver a llamar el lunes",
        ended_at: COMPLETED_AT,
      },
    ]);
  });

  it("puts the outcome on the extension call instead of logging a second one", async () => {
    const holdId = await seedHold();
    const extensionCall = await ctx.repos.calls.create({
      userId: EXEC.id,
      branchId: EXEC.branchId,
      organizationId: ORG.id,
      subject: { kind: "contact", contactId: CONTACT.id },
      phone: "+51999000111",
      source: "extension",
      startedAt: new Date(HELD_AT.getTime() + 5 * 60_000),
    });

    expectOk(await complete(holdId));

    expect(await callsOnContact()).toEqual([
      {
        id: extensionCall,
        source: "extension",
        outcome: "callback_scheduled",
        notes: "Volver a llamar el lunes",
        ended_at: COMPLETED_AT,
      },
    ]);
  });
});
