import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  TEST_FIXTURES,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { processInboundWhatsAppEvent } from "~/server/notifications/whatsapp-inbound/process-event";
import { runAsPlatform } from "~/server/platform/database/workspace-scope";

const NOW = new Date("2026-01-02T03:04:05.000Z");
const SENDER = "987654321";
const USER = TEST_FIXTURES.users.execOne;

describe("inbound WhatsApp event", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("whatsapp-inbound-workspace");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
    await ctx.db
      .insertInto("user_channel_addresses")
      .values({
        user_id: USER.id,
        channel: "whatsapp",
        address: SENDER,
        is_verified: true,
        verified_at: NOW,
        created_at: NOW,
        updated_at: NOW,
      })
      .execute();
  });

  // The queue claims inbound events from a global table, so the processor
  // starts at platform scope.
  function receive(body: string) {
    return runAsPlatform(() =>
      processInboundWhatsAppEvent(
        ctx.db,
        {
          id: crypto.randomUUID(),
          attempt_count: 0,
          max_attempts: 5,
          sender_address: SENDER,
          body,
          provider_timestamp: NOW,
        },
        NOW,
      ),
    );
  }

  it("writes an opt-out and its reply in the sender's workspace", async () => {
    expect(await receive("baja")).toEqual({
      outcome: "opted-out",
      enqueuedReply: true,
    });

    const optOutWorkspaces = await ctx.db
      .selectFrom("notification_opt_outs")
      .select("workspace_id")
      .where("user_id", "=", USER.id)
      .execute();
    expect(optOutWorkspaces.length).toBeGreaterThan(0);
    expect(
      optOutWorkspaces.every(
        (row) => row.workspace_id === TEST_FIXTURES.workspace.id,
      ),
    ).toBe(true);
    expect(
      await ctx.db
        .selectFrom("outbound_whatsapp_messages")
        .select("workspace_id")
        .execute(),
    ).toEqual([{ workspace_id: TEST_FIXTURES.workspace.id }]);
  });

  it("opens a session in the sender's workspace", async () => {
    expect(await receive("hola")).toEqual({
      outcome: "session-opened",
      enqueuedReply: false,
    });

    expect(
      await ctx.db
        .selectFrom("whatsapp_sessions")
        .select("workspace_id")
        .where("user_id", "=", USER.id)
        .execute(),
    ).toEqual([{ workspace_id: TEST_FIXTURES.workspace.id }]);
  });
});
