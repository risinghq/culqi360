import { expectErr, expectOk } from "@tests/support/_core/assertions";
import { operationAt } from "@tests/support/operation";
import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ActivityOutcomeId } from "~/domain/ids";
import { createActivitiesRuntime } from "~/server/activities/runtime";

const AT = operationAt(new Date("2026-11-17T15:00:00.000Z"));

describe("outcome admin", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("outcomes-admin");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  function runtime() {
    return createActivitiesRuntime({ executor: ctx.db });
  }

  async function outcomeId(label: string) {
    const found = (await runtime().listOutcomes()).find(
      (each) => each.label === label,
    );
    if (!found) {
      throw new Error(`outcome missing: ${label}`);
    }
    return ActivityOutcomeId.trust(found.id);
  }

  it("adds an outcome at the end of its channel and refuses a live label", async () => {
    expectOk(
      await runtime().createOutcome(
        {
          label: "Envió propuesta",
          channel: "call",
          contacted: true,
          negotiated: true,
          callback: true,
        },
        AT,
      ),
    );
    const calls = (await runtime().listOutcomes())
      .filter((each) => each.channel === "call")
      .map((each) => each.label);
    expect(calls.at(-1)).toBe("Envió propuesta");

    const repeated = await runtime().createOutcome(
      {
        label: "Envió propuesta",
        channel: "call",
        contacted: null,
        negotiated: null,
        callback: null,
      },
      AT,
    );
    expect(expectErr(repeated).code).toBe("activity_outcome_exists");
  });

  it("lets a label repeat on another channel", async () => {
    expectOk(
      await runtime().createOutcome(
        {
          label: "No contesta",
          channel: "visit",
          contacted: false,
          negotiated: null,
          callback: null,
        },
        AT,
      ),
    );
    const labels = (await runtime().listOutcomes()).filter(
      (each) => each.label === "No contesta",
    );
    expect(labels.map((each) => each.channel).toSorted()).toEqual([
      "call",
      "visit",
    ]);
  });

  it("refuses a rename onto another live label and keeps the outcome", async () => {
    const id = await outcomeId("Datos inválidos");

    const clash = await runtime().updateOutcome({
      id,
      label: "No contesta",
      contacted: false,
      negotiated: false,
      callback: false,
    });
    expect(expectErr(clash).code).toBe("activity_outcome_exists");

    expectOk(
      await runtime().updateOutcome({
        id,
        label: "Número equivocado",
        contacted: false,
        negotiated: null,
        callback: null,
      }),
    );
    expect(await runtime().listOutcomes()).toContainEqual({
      id,
      label: "Número equivocado",
      channel: "call",
      contacted: false,
      negotiated: null,
      callback: null,
    });
  });

  it("frees an archived outcome's label for a new one", async () => {
    const id = await outcomeId("Volver a llamar");

    expectOk(await runtime().archiveOutcome(id, AT));
    expect(expectErr(await runtime().archiveOutcome(id, AT)).code).toBe(
      "activity_outcome_not_found",
    );
    expect(
      (await runtime().listOutcomes()).map((each) => each.id),
    ).not.toContain(id);

    const again = expectOk(
      await runtime().createOutcome(
        {
          label: "Volver a llamar",
          channel: "call",
          contacted: true,
          negotiated: false,
          callback: true,
        },
        AT,
      ),
    );
    expect(again).not.toBe(id);
  });
});
