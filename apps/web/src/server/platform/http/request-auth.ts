import type { RequestEvent } from "@solidjs/web";

import {
  getWebhookPolicy,
  WEBHOOK_BODY_LIMIT_BYTES,
} from "~/server/platform/webhooks/registry";
import { createLogger } from "~/shared/observability/runtime-logger";

import { classifyRequest } from "./request-class";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const logger = createLogger("auth-request-guard");

/**
 * The slice of the request event the guard reads. `@solidjs/router` augments
 * `RequestEvent` with a mutable `response` head, which this module never
 * touches; asking only for what it uses keeps callers from having to hand it a
 * response stub that would go unread.
 */
type AuthRequest = Pick<RequestEvent, "request" | "locals">;

export type AuthRequestDecision =
  | { kind: "allow" }
  | { kind: "reject"; response: Response };

function reject(status: number, message: string): AuthRequestDecision {
  return { kind: "reject", response: new Response(message, { status }) };
}

export function enforceCsrfRequestPolicy(
  request: Request,
  targetOrigin: string,
): string | null {
  if (SAFE_METHODS.has(request.method)) {
    return null;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) {
    return fetchSite === "same-origin"
      ? null
      : "CSRF validation failed (Fetch Metadata)";
  }

  const sourceOrigin = getSourceOrigin(request);
  if (!sourceOrigin) {
    return "CSRF validation failed (Origin missing)";
  }

  if (sourceOrigin !== targetOrigin) {
    return "CSRF validation failed (Origin mismatch)";
  }

  return null;
}

function getSourceOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (origin) {
    return normalizeOrigin(origin);
  }

  const referer = request.headers.get("referer");
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// Machine requests use provider signatures instead of browser session and CSRF.
async function enforceWebhookRequest(
  request: Request,
  pathname: string,
): Promise<AuthRequestDecision> {
  const policy = getWebhookPolicy(pathname);
  if (!policy) {
    return reject(403, "Forbidden");
  }
  if (policy.handshakeMethods.includes(request.method)) {
    return { kind: "allow" };
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > WEBHOOK_BODY_LIMIT_BYTES) {
    return reject(413, "Payload Too Large");
  }

  // Read a clone so the route handler can still consume the original body.
  const rawBody = await request.clone().text();
  if (Buffer.byteLength(rawBody) > WEBHOOK_BODY_LIMIT_BYTES) {
    return reject(413, "Payload Too Large");
  }

  if (!policy.verify({ request, rawBody })) {
    return reject(403, "Forbidden");
  }

  return { kind: "allow" };
}

export async function enforceAuthRequest(
  event: AuthRequest,
): Promise<AuthRequestDecision> {
  const url = new URL(event.request.url);
  const requestClass = classifyRequest(url.pathname);

  if (requestClass === "machine") {
    return enforceWebhookRequest(event.request, url.pathname);
  }

  const requestContext = event.locals.requestContext;
  const targetOrigin = requestContext.publicOrigin;

  if (!SAFE_METHODS.has(event.request.method)) {
    const csrfPolicyError = enforceCsrfRequestPolicy(
      event.request,
      targetOrigin,
    );
    if (csrfPolicyError) {
      logCsrfReject(event, csrfPolicyError, targetOrigin);
      return reject(403, csrfPolicyError);
    }
  }

  if (requestClass !== "api") {
    // A page is the static shell and holds no data. Each server function
    // authenticates its own caller, and /api/auth is how a caller gets a
    // session.
    return { kind: "allow" };
  }

  // A session that has not finished sign-in has no API access.
  const session = requestContext.principal;
  if (session?.sessionClass !== "app") {
    return reject(401, "Unauthorized");
  }

  return { kind: "allow" };
}

function logCsrfReject(
  event: AuthRequest,
  reason: string,
  targetOrigin: string,
): void {
  const request = event.request;
  logger.warn("csrf_request_rejected", {
    reason,
    method: request.method,
    path: new URL(request.url).pathname,
    fetchSite: request.headers.get("sec-fetch-site"),
    origin: request.headers.get("origin"),
    targetOrigin,
    requestId: event.locals.requestContext.requestId,
    traceId: event.locals.requestContext.traceId,
  });
}
