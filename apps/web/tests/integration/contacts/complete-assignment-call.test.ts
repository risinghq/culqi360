import { expectOk } from "@tests/support/_core/assertions";
import { createContactAssignmentsTestKit } from "@tests/support/contact-assignments/kit";
import { operationAt } from "@tests/support/operation";
import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  TEST_FIXTURES,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createContactAssignmentsRuntime } from "~/server/contact-assignments/runtime";
import { Ok } from "~/shared/result";

const EXEC = TEST_FIXTURES.users.execOne;
const PERSON = TEST_FIXTURES.organizationPeople.lima;
const ORG = TEST_FIXTURES.organizations.lima;
const ASSIGNED_AT = new Date("2026-08-07T15:00:00.000Z");
const COMPLETED_AT = new Date("2026-08-07T15:20:00.000Z");

describe("completing a contact assignment", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("complete-assignment-call");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  async function seedAssignment() {
    await createContactAssignmentsTestKit(ctx).seedAssignments([
      {
        userId: EXEC.id,
        contactId: PERSON.id,
        assignedAt: ASSIGNED_AT,
        expiresAt: new Date(ASSIGNED_AT.getTime() + 24 * 60 * 60_000),
        status: "active",
      },
    ]);
    const row = await ctx.db
      .selectFrom("contact_assignments")
      .select("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  function complete(assignmentId: Awaited<ReturnType<typeof seedAssignment>>) {
    const runtime = createContactAssignmentsRuntime({
      executor: ctx.db,
      engine: { requestCandidates: async () => Ok([]) },
    });
    return runtime.completeCall(
      {
        actorUserId: EXEC.id,
        branchId: EXEC.branchId,
        assignmentId,
        contactId: PERSON.id,
        outcome: "callback_scheduled",
        notes: "Volver a llamar el lunes",
      },
      operationAt(COMPLETED_AT),
    );
  }

  function callsOnPerson() {
    return ctx.db
      .selectFrom("calls")
      .select(["id", "source", "outcome", "notes", "ended_at"])
      .where("organization_person_id", "=", PERSON.id)
      .execute();
  }

  it("records a manual call when the executive dialed outside the extension", async () => {
    const assignmentId = await seedAssignment();

    expectOk(await complete(assignmentId));

    expect(await callsOnPerson()).toEqual([
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
    const assignmentId = await seedAssignment();
    const extensionCall = await ctx.repos.calls.create({
      userId: EXEC.id,
      branchId: EXEC.branchId,
      organizationId: ORG.id,
      subject: { kind: "person", organizationPersonId: PERSON.id },
      phone: "+51999000111",
      source: "extension",
      startedAt: new Date(ASSIGNED_AT.getTime() + 5 * 60_000),
    });

    expectOk(await complete(assignmentId));

    expect(await callsOnPerson()).toEqual([
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
