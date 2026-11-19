import { createRequestContext } from "@tests/support/auth/request-context";
import { makeAuthSession } from "@tests/support/unit/factories";
import { describe, expect, it } from "vitest";

import type { AuthSession } from "~/domain/auth/access/session-types";
import {
  enforceCsrfRequestPolicy,
  enforceAuthRequest,
} from "~/server/platform/http/request-auth";

const LOCAL_ORIGIN = "http://localhost:3000";

async function statusFor(
  path: string,
  session: AuthSession | null,
): Promise<number | "allow"> {
  const decision = await enforceAuthRequest({
    request: new Request(`${LOCAL_ORIGIN}${path}`),
    locals: { requestContext: createRequestContext(session) },
  });
  return decision.kind === "allow" ? "allow" : decision.response.status;
}

describe("auth request session policy", () => {
  it("rejects an API request without a session", async () => {
    expect(await statusFor("/api/me/avatar", null)).toBe(401);
  });

  it("rejects an API request from a session that has not finished sign-in", async () => {
    const session = makeAuthSession({ sessionClass: "pre_auth" });
    expect(await statusFor("/api/me/avatar", session)).toBe(401);
  });

  it("allows an API request from an app session", async () => {
    const session = makeAuthSession({ role: "executive" });
    expect(await statusFor("/api/me/avatar", session)).toBe("allow");
  });

  it("serves a page and the sign-in API without a session", async () => {
    expect(await statusFor("/records", null)).toBe("allow");
    expect(await statusFor("/api/auth/google", null)).toBe("allow");
    expect(await statusFor("/_server", null)).toBe("allow");
  });
});

describe("auth middleware csrf policy", () => {
  it("allows same-origin unsafe requests via fetch metadata", () => {
    const error = enforceCsrfRequestPolicy(
      new Request("http://localhost:3000/home", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
      LOCAL_ORIGIN,
    );
    expect(error).toBeNull();
  });

  it("rejects cross-site unsafe requests via fetch metadata", () => {
    const error = enforceCsrfRequestPolicy(
      new Request("http://localhost:3000/home", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      }),
      LOCAL_ORIGIN,
    );
    expect(error).toBe("CSRF validation failed (Fetch Metadata)");
  });

  it("rejects same-site unsafe requests via fetch metadata", () => {
    const error = enforceCsrfRequestPolicy(
      new Request("http://localhost:3000/home", {
        method: "POST",
        headers: { "sec-fetch-site": "same-site" },
      }),
      LOCAL_ORIGIN,
    );
    expect(error).toBe("CSRF validation failed (Fetch Metadata)");
  });

  it("rejects requests with no fetch metadata context (none)", () => {
    const error = enforceCsrfRequestPolicy(
      new Request("http://localhost:3000/home", {
        method: "POST",
        headers: { "sec-fetch-site": "none" },
      }),
      LOCAL_ORIGIN,
    );
    expect(error).toBe("CSRF validation failed (Fetch Metadata)");
  });

  it("accepts a request whose origin matches the target origin", () => {
    const error = enforceCsrfRequestPolicy(
      new Request("http://localhost:3000/home", {
        method: "POST",
        headers: { Origin: LOCAL_ORIGIN },
      }),
      LOCAL_ORIGIN,
    );
    expect(error).toBeNull();
  });

  it("falls back to strict origin matching when fetch metadata is absent", () => {
    const error = enforceCsrfRequestPolicy(
      new Request("http://localhost:3000/home", {
        method: "POST",
        headers: { Origin: "http://evil.local" },
      }),
      LOCAL_ORIGIN,
    );
    expect(error).toBe("CSRF validation failed (Origin mismatch)");
  });

  it("derives the source origin from the referer when Origin is absent", () => {
    const error = enforceCsrfRequestPolicy(
      new Request("http://localhost:3000/home", {
        method: "POST",
        headers: { Referer: "http://evil.local/some/path" },
      }),
      LOCAL_ORIGIN,
    );
    expect(error).toBe("CSRF validation failed (Origin mismatch)");
  });

  it("fails closed when fetch metadata and origin headers are absent", () => {
    const error = enforceCsrfRequestPolicy(
      new Request("http://localhost:3000/home", { method: "POST" }),
      LOCAL_ORIGIN,
    );
    expect(error).toBe("CSRF validation failed (Origin missing)");
  });

  it("allows a same-origin unsafe request to a public path", async () => {
    const decision = await enforceAuthRequest({
      request: new Request("http://localhost:3000/login", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
      locals: { requestContext: createRequestContext(null) },
    });
    expect(decision.kind).toBe("allow");
  });

  it("rejects a cross-site unsafe request before it reaches the route", async () => {
    const decision = await enforceAuthRequest({
      request: new Request("http://localhost:3000/login", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      }),
      locals: { requestContext: createRequestContext(null) },
    });
    expect(decision.kind).toBe("reject");
  });

  it("allows GET requests even when Origin does not match Host", async () => {
    const decision = await enforceAuthRequest({
      request: new Request("http://localhost:3000/login", {
        method: "GET",
        headers: {
          Origin: "http://evil.local",
          Host: "localhost:3000",
        },
      }),
      locals: { requestContext: createRequestContext(null) },
    });

    expect(decision.kind).not.toBe("reject");
  });

  it("allows the webhook GET handshake without a session or CSRF token", async () => {
    const decision = await enforceAuthRequest({
      request: new Request(
        "http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe",
        { method: "GET" },
      ),
      locals: { requestContext: createRequestContext(null) },
    });

    expect(decision.kind).toBe("allow");
  });

  it("rejects unsigned methods not allowed by the webhook policy", async () => {
    const decision = await enforceAuthRequest({
      request: new Request("http://localhost:3000/api/webhooks/whatsapp", {
        method: "HEAD",
      }),
      locals: { requestContext: createRequestContext(null) },
    });

    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") {
      throw new Error("Expected reject");
    }
    expect(decision.response.status).toBe(403);
  });

  it("rejects unregistered webhook paths for every method", async () => {
    const decision = await enforceAuthRequest({
      request: new Request("http://localhost:3000/api/webhooks/unknown"),
      locals: { requestContext: createRequestContext(null) },
    });

    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") {
      throw new Error("Expected reject");
    }
    expect(decision.response.status).toBe(403);
  });

  it("rejects an unsigned webhook POST before it reaches the handler", async () => {
    const decision = await enforceAuthRequest({
      request: new Request("http://localhost:3000/api/webhooks/whatsapp", {
        method: "POST",
        body: JSON.stringify({ object: "whatsapp_business_account" }),
      }),
      locals: { requestContext: createRequestContext(null) },
    });

    expect(decision.kind).toBe("reject");
    if (decision.kind !== "reject") {
      throw new Error("Expected reject");
    }
    expect(decision.response.status).toBe(403);
  });
});
