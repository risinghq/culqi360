import { createTestNotificationRuntime } from "@tests/support/integration/notification-runtime";
import { operationAt } from "@tests/support/operation";
import {
  createTestRuntime,
  type TestRuntime,
} from "@tests/support/runtime/app";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { WorkspaceId } from "~/domain/ids";
import { createWhatsAppRouter } from "~/server/integrations/kapso/webhooks/route-delivery";

const NOW = new Date("2026-01-02T03:04:05.000Z");
const PHONE_NUMBER_ID = "phone-number-1";

function delivery(rawBody: string) {
  return {
    idempotencyKey: "delivery-1",
    eventType: "whatsapp.message.received",
    payloadVersion: "v2",
    rawBody,
  };
}

function message(phoneNumberId: string) {
  return JSON.stringify({
    phone_number_id: phoneNumberId,
    conversation: { id: "conversation-1", phone_number: "51987654321" },
    message: {
      id: "wamid.routed",
      timestamp: "1767225600",
      text: { body: "VERIFICAR" },
      kapso: { direction: "inbound", phone_number_id: phoneNumberId },
    },
  });
}

describe("whatsapp delivery routing", () => {
  let runtime: TestRuntime;
  let opened: WorkspaceId[];

  function router() {
    const receiver = createTestNotificationRuntime(runtime).webhooks;
    return createWhatsAppRouter(runtime.ctx.platform, async (workspaceId) => {
      opened.push(workspaceId);
      return { receiveWhatsApp: receiver.receiveKapso };
    });
  }

  beforeAll(async () => {
    runtime = await createTestRuntime("whatsapp-routing");
  });

  afterAll(async () => {
    await runtime.dispose();
  });

  beforeEach(async () => {
    await runtime.reset();
    runtime.now.set(NOW);
    opened = [];
  });

  it("acknowledges a number no workspace owns without opening a store", async () => {
    expect(
      await router()(delivery(message("unknown-number")), operationAt(NOW)),
    ).toEqual({ ok: true, value: "unrouted" });
    expect(opened).toEqual([]);
  });

  it("hands a delivery to the workspace that owns its number", async () => {
    const workspaceId = runtime.ctx.fixtures.workspace.id;
    await runtime.ctx.platform
      .insertInto("whatsapp_numbers")
      .values({ phone_number_id: PHONE_NUMBER_ID, workspace_id: workspaceId })
      .execute();

    expect(
      await router()(delivery(message(PHONE_NUMBER_ID)), operationAt(NOW)),
    ).toEqual({ ok: true, value: "accepted" });
    expect(opened).toEqual([workspaceId]);

    const events = await runtime.ctx.db
      .selectFrom("whatsapp_inbound_events")
      .select("id")
      .execute();
    expect(events).toHaveLength(1);
  });

  it("rejects a body it cannot read", async () => {
    const result = await router()(delivery("{not json"), operationAt(NOW));
    expect(result.ok).toBe(false);
    expect(opened).toEqual([]);
  });
});
