import { getSeededIdentity } from "@tests/support/identities/api";
import { operationAt } from "@tests/support/operation";
import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSessionAuthenticator } from "~/server/auth/session/session.service";
import {
  generateSessionToken,
  hashSessionToken,
} from "~/server/auth/session/tokens";
import { createSessionRepository } from "~/server/sessions/repos-sessions";

const IDENTITY = getSeededIdentity("execOne");
const NOW = new Date("2026-07-15T12:00:00.000Z");

describe("session authentication", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("session-cache");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  function makeAuthenticator() {
    return createSessionAuthenticator({
      sessions: createSessionRepository(ctx.platform),
      workspaces: ctx.authWorkspaces,
      logger: { error() {} },
    });
  }

  async function seedSession(
    sessionId: string,
    overrides: { session_class?: "app" | "pre_auth" } = {},
  ) {
    await ctx.platform
      .insertInto("user_sessions")
      .values({
        id: sessionId,
        account_id: IDENTITY.userId,
        workspace_id: ctx.fixtures.workspace.id,
        session_class: overrides.session_class ?? "app",
        primary_auth_method: "password",
        strong_auth_method: null,
        strong_auth_at: null,
        impersonator_account_id: null,
        ip_address: null,
        user_agent: null,
        created_at: NOW,
        last_activity: NOW,
        expires_at: new Date(NOW.getTime() + 60 * 60_000),
      })
      .execute();
  }

  it("resolves a session from the database and reflects its persisted session class", async () => {
    const token = generateSessionToken();
    const sessionId = hashSessionToken(token);

    await seedSession(sessionId, { session_class: "pre_auth" });

    const result = await makeAuthenticator().resolve(token, operationAt(NOW));

    expect(result?.sessionClass).toBe("pre_auth");
    expect(result?.role).toBe(IDENTITY.role);
  });

  it("carries the workspace modules into the session", async () => {
    const token = generateSessionToken();
    const sessionId = hashSessionToken(token);

    await seedSession(sessionId);

    const culqi = await makeAuthenticator().resolve(token, operationAt(NOW));
    expect(culqi?.modules).toEqual(["culqi", "contacts"]);

    await ctx.db
      .updateTable("workspace_settings")
      .set({ modules: [] })
      .execute();

    const caseOnly = await makeAuthenticator().resolve(token, operationAt(NOW));
    expect(caseOnly?.modules).toEqual([]);
  });

  it("reads the member's current role on each request", async () => {
    const token = generateSessionToken();
    await seedSession(hashSessionToken(token));

    const role = await ctx.db
      .selectFrom("workspace_roles")
      .select(["id", "kind"])
      .where("key", "=", "back_office")
      .executeTakeFirstOrThrow();
    await ctx.db
      .updateTable("members")
      .set({ role_id: role.id, role: role.kind })
      .where("user_id", "=", IDENTITY.userId)
      .execute();

    const result = await makeAuthenticator().resolve(token, operationAt(NOW));
    expect(result).toMatchObject({
      roleKey: "back_office",
      role: "back_office",
    });
  });
});
