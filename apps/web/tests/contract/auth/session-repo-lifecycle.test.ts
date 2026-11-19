import { createAuthScenario } from "@tests/support/auth/scenario";
import { seedBulkSessions } from "@tests/support/auth/sessions";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { UserId } from "~/domain/ids";
import type { NewUserSessionRow } from "~/server/sessions/repos-sessions";

const NOW = new Date("2026-01-01T00:00:00Z");

function sessionRow(
  id: string,
  userId: UserId,
  expiresAt: Date,
): NewUserSessionRow {
  return {
    id,
    user_id: userId,
    impersonator_user_id: null,
    session_class: "app",
    primary_auth_method: "password",
    strong_auth_method: null,
    strong_auth_at: null,
    ip_address: "127.0.0.1",
    user_agent: "vitest",
    created_at: NOW,
    last_activity: NOW,
    expires_at: expiresAt,
  };
}

describe("session repository lifecycle", () => {
  const scenario = createAuthScenario("session-repo");

  beforeAll(async () => {
    await scenario.setup();
  });

  afterAll(async () => {
    await scenario.teardown();
  });

  beforeEach(async () => {
    await scenario.reset();
  });

  it("creates, reads, touches, and deletes a session", async () => {
    const sessions = scenario.ctx.repos.sessions;
    const { userId } = scenario.identity("execOne");
    const activityAt = new Date("2026-01-01T00:00:05Z");
    const extendedExpiresAt = new Date("2026-01-01T00:02:00Z");

    await sessions.create(
      sessionRow("session-lifecycle", userId, new Date("2026-01-01T00:01:00Z")),
    );
    expect((await sessions.findById("session-lifecycle"))?.user_id).toBe(
      userId,
    );

    await sessions.touch("session-lifecycle", {
      last_activity: activityAt,
      expires_at: extendedExpiresAt,
    });
    const touched = await sessions.findById("session-lifecycle");
    expect(touched?.last_activity).toEqual(activityAt);
    expect(touched?.expires_at).toEqual(extendedExpiresAt);

    await sessions.delete("session-lifecycle");
    expect(await sessions.findById("session-lifecycle")).toBeNull();
  });

  it("reports the next expiry and deletes only expired sessions", async () => {
    const sessions = scenario.ctx.repos.sessions;
    const { userId } = scenario.identity("execOne");
    const expiredAt = new Date("2025-12-31T23:59:59Z");

    await sessions.create(
      sessionRow("active-1", userId, new Date("2026-01-01T00:01:00Z")),
    );
    await sessions.create(sessionRow("expired-1", userId, expiredAt));

    expect(await sessions.nextExpiryAt()).toEqual(expiredAt);
    expect(await sessions.deleteExpired(NOW)).toBe(1);
    expect(await sessions.findById("expired-1")).toBeNull();
    expect(await sessions.findById("active-1")).not.toBeNull();
  });

  it("deletes a user's sessions without touching another user's", async () => {
    const sessions = scenario.ctx.repos.sessions;
    const one = scenario.identity("execOne").userId;
    const two = scenario.identity("execTwo").userId;
    const later = new Date("2026-01-02T00:00:00Z");

    await seedBulkSessions(scenario.ctx, "execOne", 200);
    await sessions.create(sessionRow("other-user", two, later));

    // A session id that belongs to another user deletes nothing.
    await sessions.deleteForUser(one, "other-user");
    expect(await sessions.findById("other-user")).not.toBeNull();

    await sessions.deleteForUser(one);
    expect(await sessions.findById("bulk-0")).toBeNull();
    expect(await sessions.findById("bulk-199")).toBeNull();
    expect(await sessions.findById("other-user")).not.toBeNull();
  });
});
