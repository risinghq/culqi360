import { expectErr } from "@tests/support/_core/assertions";
import { createExtensionScenario } from "@tests/support/extension/api";
import { createExtensionFixture } from "@tests/support/extension/fixture";
import { operationAt } from "@tests/support/operation";
import {
  cleanupTestDb,
  resetTestDb,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("extension runtime token validation", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createExtensionFixture("extension-runtime-token-validation");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  it("classifies malformed handoff tokens as handoff_invalid", async () => {
    const scenario = createExtensionScenario(ctx);
    const now = new Date();

    const result = await scenario.service.claimInstallationSession(
      {
        handoffToken: "not-a-jwt",
        installationId: "11111111-1111-4111-8111-111111111111",
      },
      operationAt(now),
    );

    const error = expectErr(result);

    expect(error.code).toBe("handoff_invalid");
  });

  it("refuses a call target when neither the person nor the company has a phone", async () => {
    const scenario = createExtensionScenario(ctx);
    const { execOne } = ctx.fixtures.users;
    const contactId = await scenario.contactWithoutPhone(1);
    const contactHoldId = await scenario.contactHold({
      userId: execOne.id,
      contactId,
    });

    const result = await scenario.calls.resolveTarget(
      {
        userId: execOne.id,
        branchId: execOne.branchId,
        roleKey: "executive",
        viewAll: false,
      },
      { subject: { kind: "contact_hold", contactHoldId }, phone: null },
      new Date(),
    );

    expect(expectErr(result).code).toBe("call_phone_missing");
  });

  it("classifies malformed session tokens as extension_session_invalid", async () => {
    const scenario = createExtensionScenario(ctx);
    const now = new Date();

    const result = await scenario.service.ingestRuntimeEvent(
      {
        sessionToken: "not-a-jwt",
        event: {
          id: "evt-invalid-session",
          sequence: 1,
          type: "executive.heartbeat",
          createdAt: 10_000,
          payload: { occurredAt: 10_000 },
        },
      },
      operationAt(now),
    );

    const error = expectErr(result);

    expect(error.code).toBe("extension_session_invalid");
  });
});
