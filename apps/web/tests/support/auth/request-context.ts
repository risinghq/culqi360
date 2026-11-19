import type { AuthSession } from "~/domain/auth/access/session-types";
import type { RequestContext } from "~/server/platform/http/request-context-storage";

export function createRequestContext(
  session: AuthSession | null,
): RequestContext {
  return {
    traceId: "trace-id",
    requestId: "request-id",
    route: "/home",
    method: "GET",
    startedAt: new Date(1_700_000_000_000),
    startedTicks: 0,
    principal: session,
    publicOrigin: "http://localhost:3000",
    clientIp: "127.0.0.1",
    userAgent: "vitest",
  };
}
