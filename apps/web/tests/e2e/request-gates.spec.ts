import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";

import {
  generateSessionToken,
  hashSessionToken,
} from "~/server/auth/session/tokens";

import { expect, test } from "./fixtures";
import { rosterByKey } from "./roster";

const REALTIME_STREAM =
  "/api/realtime/leads/0e2e0000-0000-7000-8000-00000000dead/stream";

const UNFINISHED_SESSIONS = [
  { sessionClass: "pre_auth", page: "/onboarding" },
  { sessionClass: "recovery_setup", page: "/recovery-codes" },
] as const;

function clientWithSession(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string,
  token: string,
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: `session=${token}` },
  });
}

// Every request below crosses the whole middleware chain of the production
// server, so a fault in any link shows as a 5xx on the first one.
test.describe("request gates", () => {
  test("a page request is served with the security headers", async ({
    request,
  }) => {
    const response = await request.get("/login");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-security-policy"]).toContain(
      "default-src 'self'",
    );
    expect(response.headers()["server-timing"]).toMatch(/^app;dur=\d+$/);
  });

  test("an anonymous API request gets 401 instead of a login redirect", async ({
    request,
  }) => {
    const response = await request.get(REALTIME_STREAM, { maxRedirects: 0 });

    expect(response.status()).toBe(401);
  });

  test("an API route runs for a signed-in session", async ({
    playwright,
    workerServer,
  }) => {
    const client = await clientWithSession(
      playwright,
      workerServer.baseURL,
      rosterByKey("executive").token,
    );

    const response = await client.get("/api/me/avatar", { maxRedirects: 0 });
    await client.dispose();

    expect(response.status()).not.toBe(401);
    expect(response.status()).toBeLessThan(500);
  });

  for (const { sessionClass, page } of UNFINISHED_SESSIONS) {
    test.describe(`a ${sessionClass} session`, () => {
      const token = generateSessionToken();

      test.beforeEach(({ workerData }) => {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        workerData.platform.run(
          `insert into user_sessions (
             id, account_id, workspace_id, session_class, primary_auth_method,
             ip_address, user_agent, created_at, last_activity, expires_at
           )
           select ?, account_id, workspace_id, ?, 'password',
                  '127.0.0.1', 'e2e', ?, ?, ?
           from memberships where account_id = ?`,
          hashSessionToken(token),
          sessionClass,
          now.toISOString(),
          now.toISOString(),
          expiresAt.toISOString(),
          rosterByKey("executive").userId,
        );
      });

      test("gets 401 on an API path so realtime clients stop", async ({
        playwright,
        workerServer,
      }) => {
        const client = await clientWithSession(
          playwright,
          workerServer.baseURL,
          token,
        );

        const response = await client.get(REALTIME_STREAM, {
          maxRedirects: 0,
        });
        await client.dispose();

        expect(response.status()).toBe(401);
      });

      test("is redirected from a page to finish sign-in", async ({
        playwright,
        workerServer,
      }) => {
        const client = await clientWithSession(
          playwright,
          workerServer.baseURL,
          token,
        );

        const response = await client.get("/home", { maxRedirects: 0 });
        await client.dispose();

        expect(response.status()).toBe(302);
        expect(
          new URL(response.headers().location ?? "", workerServer.baseURL)
            .pathname,
        ).toBe(page);
      });
    });
  }
});
