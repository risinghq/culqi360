import { getSeededIdentity } from "@tests/support/identities/api";
import { operationAt } from "@tests/support/operation";
import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSessionAuthenticator } from "~/server/auth/session/session.service";
import {
  generateSessionToken,
  hashSessionToken,
} from "~/server/auth/session/tokens";
import { createSessionRepository } from "~/server/sessions/repos-sessions";
import { createUsersRepo } from "~/server/users/repos-users";

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
      sessions: createSessionRepository(ctx.db),
      users: createUsersRepo(ctx.db),
      logger: { error() {} },
    });
  }

  async function seedSession(
    sessionId: string,
    overrides: { session_class?: "app" | "pre_auth" } = {},
  ) {
    await ctx.db
      .insertInto("user_sessions")
      .values({
        id: sessionId,
        user_id: IDENTITY.userId,
        branch_id: IDENTITY.branchId,
        session_class: overrides.session_class ?? "app",
        primary_auth_method: "password",
        strong_auth_method: null,
        strong_auth_at: null,
        impersonator_user_id: null,
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

    await sql`update workspaces set modules = '{}'`.execute(ctx.db);

    const caseOnly = await makeAuthenticator().resolve(token, operationAt(NOW));
    expect(caseOnly?.modules).toEqual([]);
  });

  it("reads the member's current role on each request", async () => {
    const token = generateSessionToken();
    await seedSession(hashSessionToken(token));

    await sql`
      update users u
      set role_id = r.id, role = r.kind
      from workspace_roles r
      where u.id = ${IDENTITY.userId}
        and r.workspace_id = u.workspace_id
        and r.key = 'back_office'
    `.execute(ctx.db);

    const result = await makeAuthenticator().resolve(token, operationAt(NOW));
    expect(result).toMatchObject({
      roleKey: "back_office",
      role: "back_office",
    });
  });
});
