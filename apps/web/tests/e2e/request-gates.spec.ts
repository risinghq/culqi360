import type {
  APIRequestContext,
  Page,
  PlaywrightWorkerArgs,
} from "@playwright/test";

import { JOB_KINDS, jobSubscriptionId } from "~/contracts/jobs/job-event";
import {
  REALTIME_CHANNELS,
  REALTIME_CLOSE,
  realtimeSocketUrl,
} from "~/contracts/realtime/channel";
import {
  generateSessionToken,
  hashSessionToken,
} from "~/server/auth/session/tokens";
import { INSTALLATION_WORKSPACE_ID } from "~/server/platform/database/seeds/installation/workspace-id";

import { expect, test } from "./fixtures";
import { rosterByKey } from "./roster";

const MISSING_LEAD_SOCKET =
  "/api/realtime/leads/0e2e0000-0000-7000-8000-00000000dead/socket";

// The browser hides a refused handshake's status, so the server refuses by
// closing an accepted socket, and the close code is what a client sees.
async function socketCloseCode(tab: Page, path: string): Promise<number> {
  await tab.goto("/login");
  return tab.evaluate(
    (socketPath) =>
      new Promise<number>((resolve) => {
        const url = new URL(socketPath, location.href);
        url.protocol = "ws:";
        const socket = new WebSocket(url.href);
        socket.addEventListener("close", (event) => resolve(event.code));
      }),
    path,
  );
}

// Resolves with the first frame's payload, or with the close code when the
// server refuses the subscription.
async function socketFirstFrame(tab: Page, path: string): Promise<unknown> {
  return tab.evaluate(
    (socketPath) =>
      new Promise<unknown>((resolve) => {
        const url = new URL(socketPath, location.href);
        url.protocol = "ws:";
        const socket = new WebSocket(url.href);
        socket.addEventListener("message", (event) => {
          const frame = String(event.data);
          resolve(JSON.parse(frame.slice(frame.indexOf("\n") + 1)));
          socket.close();
        });
        socket.addEventListener("close", (event) => resolve(event.code));
      }),
    path,
  );
}

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
    const response = await request.get("/api/me/avatar", { maxRedirects: 0 });

    expect(response.status()).toBe(401);
  });

  test("an anonymous realtime socket is closed as unauthenticated", async ({
    page,
  }) => {
    expect(await socketCloseCode(page, MISSING_LEAD_SOCKET)).toBe(
      REALTIME_CLOSE.unauthenticated,
    );
  });

  test("a signed-in realtime socket reaches its channel", async ({
    asExecutive,
  }) => {
    expect(await socketCloseCode(asExecutive, MISSING_LEAD_SOCKET)).toBe(
      REALTIME_CLOSE.notFound,
    );
  });

  // A job subscription id holds a colon, which the client percent-encodes
  // into the path.
  test("a job socket answers with the job's current state", async ({
    asExecutive,
  }) => {
    await asExecutive.goto("/home");
    const ruc = "20100047218";

    const frame = await socketFirstFrame(
      asExecutive,
      realtimeSocketUrl(
        REALTIME_CHANNELS.jobs,
        jobSubscriptionId(JOB_KINDS.clientEnrichment, ruc),
        null,
      ),
    );

    expect(frame).toMatchObject({
      kind: JOB_KINDS.clientEnrichment,
      subjectId: ruc,
    });
  });

  test("a realtime socket from another site is refused", async ({
    request,
  }) => {
    const response = await request.get(MISSING_LEAD_SOCKET, {
      headers: {
        connection: "upgrade",
        upgrade: "websocket",
        origin: "https://evil.example",
        "sec-websocket-key": Buffer.from(
          crypto.getRandomValues(new Uint8Array(16)),
        ).toString("base64"),
        "sec-websocket-version": "13",
      },
    });

    expect(response.status()).toBe(403);
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
      const token = generateSessionToken(INSTALLATION_WORKSPACE_ID);

      test.beforeEach(({ workerData }) => {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        workerData.workspace.run(
          `insert into user_sessions (
             id, user_id, session_class, primary_auth_method,
             ip_address, user_agent, created_at, last_activity, expires_at
           ) values (?, ?, ?, 'password', '127.0.0.1', 'e2e', ?, ?, ?)`,
          hashSessionToken(token),
          rosterByKey("executive").userId,
          sessionClass,
          now.toISOString(),
          now.toISOString(),
          expiresAt.toISOString(),
        );
      });

      test("gets 401 on an API path", async ({ playwright, workerServer }) => {
        const client = await clientWithSession(
          playwright,
          workerServer.baseURL,
          token,
        );

        const response = await client.get("/api/me/avatar", {
          maxRedirects: 0,
        });
        await client.dispose();

        expect(response.status()).toBe(401);
      });

      test("has its realtime socket closed so the client stops", async ({
        browser,
        workerServer,
      }) => {
        const context = await browser.newContext({
          baseURL: workerServer.baseURL,
        });
        await context.addCookies([
          { name: "session", value: token, url: workerServer.baseURL },
        ]);

        const code = await socketCloseCode(
          await context.newPage(),
          MISSING_LEAD_SOCKET,
        );
        await context.close();

        expect(code).toBe(REALTIME_CLOSE.unauthenticated);
      });

      test("is held on the page that finishes sign-in", async ({
        browser,
        workerServer,
      }) => {
        const context = await browser.newContext({
          baseURL: workerServer.baseURL,
        });
        await context.addCookies([
          { name: "session", value: token, url: workerServer.baseURL },
        ]);
        const tab = await context.newPage();

        await tab.goto("/home");

        await expect(tab).toHaveURL(new URL(page, workerServer.baseURL).href);
        await context.close();
      });
    });
  }
});
