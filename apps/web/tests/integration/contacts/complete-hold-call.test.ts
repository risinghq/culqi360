import { expectErr, expectOk } from "@tests/support/_core/assertions";
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

import type { ActivityOutcomeId } from "~/domain/ids";
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

  // The fixture workspace starts with the baseline outcomes.
  async function outcomeId(label: string) {
    const outcomes = await ctx.repos.outcomes.listLive();
    const outcome = outcomes.find((each) => each.label === label);
    if (!outcome) {
      throw new Error(`baseline outcome missing: ${label}`);
    }
    return outcome.id;
  }

  function complete(
    holdId: Awaited<ReturnType<typeof seedHold>>,
    outcome: ActivityOutcomeId,
  ) {
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
        outcomeId: outcome,
        notes: "Volver a llamar el lunes",
      },
      operationAt(COMPLETED_AT),
    );
  }

  function activitiesOnContact() {
    return ctx.db
      .selectFrom("activities")
      .select(["id", "channel", "source", "outcome_id", "notes", "ended_at"])
      .where("contact_id", "=", CONTACT.id)
      .orderBy("started_at")
      .execute();
  }

  function holdStatus() {
    return ctx.db
      .selectFrom("contact_holds")
      .select("status")
      .executeTakeFirstOrThrow();
  }

  it("records a manual call when the executive dialed outside the extension", async () => {
    const holdId = await seedHold();
    const callback = await outcomeId("Volver a llamar");

    expectOk(await complete(holdId, callback));

    expect(await activitiesOnContact()).toEqual([
      {
        id: expect.any(String),
        channel: "call",
        source: "manual",
        outcome_id: callback,
        notes: "Volver a llamar el lunes",
        ended_at: COMPLETED_AT,
      },
    ]);
  });

  it("puts the outcome on the extension call instead of logging a second one", async () => {
    const holdId = await seedHold();
    const callback = await outcomeId("Volver a llamar");
    const extensionCall = await ctx.repos.activities.create({
      channel: "call",
      userId: EXEC.id,
      branchId: EXEC.branchId,
      organizationId: ORG.id,
      subject: { kind: "contact", contactId: CONTACT.id },
      phone: "+51999000111",
      source: "extension",
      startedAt: new Date(HELD_AT.getTime() + 5 * 60_000),
    });

    expectOk(await complete(holdId, callback));

    expect(await activitiesOnContact()).toEqual([
      {
        id: extensionCall,
        channel: "call",
        source: "extension",
        outcome_id: callback,
        notes: "Volver a llamar el lunes",
        ended_at: COMPLETED_AT,
      },
    ]);
  });

  it("logs a visit outcome as its own visit, leaving the extension call alone", async () => {
    const holdId = await seedHold();
    const visited = await outcomeId("Visita realizada");
    const extensionCall = await ctx.repos.activities.create({
      channel: "call",
      userId: EXEC.id,
      branchId: EXEC.branchId,
      organizationId: ORG.id,
      subject: { kind: "contact", contactId: CONTACT.id },
      phone: "+51999000111",
      source: "extension",
      startedAt: new Date(HELD_AT.getTime() + 5 * 60_000),
    });

    expectOk(await complete(holdId, visited));

    expect(await activitiesOnContact()).toEqual([
      {
        id: extensionCall,
        channel: "call",
        source: "extension",
        outcome_id: null,
        notes: null,
        ended_at: null,
      },
      {
        id: expect.any(String),
        channel: "visit",
        source: "manual",
        outcome_id: visited,
        notes: "Volver a llamar el lunes",
        ended_at: COMPLETED_AT,
      },
    ]);
  });

  it("refuses an archived outcome and keeps the hold open", async () => {
    const holdId = await seedHold();
    const callback = await outcomeId("Volver a llamar");
    await ctx.repos.outcomes.archive(callback, COMPLETED_AT);

    const error = expectErr(await complete(holdId, callback));

    expect(error.code).toBe("activity_outcome_not_found");
    expect(await activitiesOnContact()).toEqual([]);
    expect(await holdStatus()).toEqual({ status: "active" });
  });
});
