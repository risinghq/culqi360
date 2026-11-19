import type { AuthSession } from "~/domain/auth/access/session-types";
import { getClientIp } from "~/server/auth/password/client-ip";
import { getSessionCookie } from "~/server/auth/session/cookies";
import type { OperationContext } from "~/server/platform/operation/context";

import { resolvePublicOrigin } from "./public-origin";
import type { RequestContext } from "./request-context-storage";

export interface RequestIdentity {
  traceId: string;
  requestId: string;
  startedAt: Date;
  startedTicks: number;
  nonce: string;
}

export interface RequestContextDeps {
  resolveAuthSession(
    this: void,
    token: string,
    operation: OperationContext,
  ): Promise<AuthSession | null>;
}

// Middleware owns cookie access.
export async function buildRequestContext(
  request: Request,
  identity: RequestIdentity,
  deps: RequestContextDeps,
  trustedProxy: boolean,
): Promise<RequestContext> {
  const principal = await loadAuthSession(deps.resolveAuthSession, {
    operationAt: identity.startedAt,
  });

  return {
    ...buildAnonymousRequestContext(request, identity, trustedProxy),
    principal,
  };
}

export function buildAnonymousRequestContext(
  request: Request,
  identity: RequestIdentity,
  trustedProxy: boolean,
): RequestContext {
  const url = new URL(request.url);

  return {
    ...identity,
    route: url.pathname,
    method: request.method,
    principal: null,
    publicOrigin: resolvePublicOrigin(request, { trustedProxy }),
    clientIp: getClientIp(request.headers, trustedProxy),
    userAgent: request.headers.get("user-agent") ?? null,
  };
}

async function loadAuthSession(
  resolveAuthSession: RequestContextDeps["resolveAuthSession"],
  operation: OperationContext,
): Promise<AuthSession | null> {
  const token = getSessionCookie();

  if (!token) {
    return null;
  }

  return resolveAuthSession(token, operation);
}
