import { getClientIp } from "~/server/auth/password/client-ip";

import { resolvePublicOrigin } from "./public-origin";
import type { RequestContext } from "./request-context-storage";

export interface RequestIdentity {
  traceId: string;
  requestId: string;
  startedAt: Date;
  startedTicks: number;
}

// The context every request starts with. The middleware adds the principal
// once it has resolved the session cookie.
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
