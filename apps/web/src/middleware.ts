import type { StartMiddleware } from "@solidjs/vite-plugin";
import { createAPIHandler } from "filesystem-routing/api";
import routes from "virtual:file-routes";

import { runningHost } from "./server/entrypoints/runtime-lifecycle";
import { middlewareConfig } from "./server/platform/config/middleware-config";
import { enforceAuthRequest } from "./server/platform/http/request-auth";
import { classifyRequest } from "./server/platform/http/request-class";
import {
  buildAnonymousRequestContext,
  buildRequestContext,
} from "./server/platform/http/request-context-builder";
import { securityHeaders } from "./server/platform/http/security-headers";
import { generateRequestId, generateTraceId } from "./shared/observability/ids";

const SECURITY_HEADERS = securityHeaders({
  development: import.meta.env.DEV,
  browserSentryDsn: import.meta.env.VITE_SENTRY_DSN ?? "",
});

const identifyRequest: StartMiddleware = (event, next) => {
  const { trustedProxy } = middlewareConfig();

  event.locals.requestContext = buildAnonymousRequestContext(
    event.request,
    {
      traceId: generateTraceId(),
      requestId: generateRequestId(),
      startedAt: new Date(), // clock-boundary: HTTP request arrival
      startedTicks: performance.now(),
    },
    trustedProxy,
  );

  return next();
};

const applySecurityHeaders: StartMiddleware = (event, next) => {
  const headers = event.response.headers;
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return next();
};

const resolveSession: StartMiddleware = async (event, next) => {
  if (classifyRequest(new URL(event.request.url).pathname) === "page") {
    return next();
  }

  const current = event.locals.requestContext;
  const { trustedProxy } = middlewareConfig();
  const { host } = await runningHost();

  const context = await buildRequestContext(
    event.request,
    {
      traceId: current.traceId,
      requestId: current.requestId,
      startedAt: current.startedAt,
      startedTicks: current.startedTicks,
    },
    host.platform.http.requestContext,
    trustedProxy,
  );

  event.locals.requestContext = context;

  // Anonymous requests are the login, recovery, invite and webhook flows, which
  // run on the platform and find their workspace from what they read.
  if (context.principal) {
    event.locals.application = await host.workspace(
      context.principal.workspaceId,
    );
  }

  return next();
};

const authorizeRequest: StartMiddleware = async (event, next) => {
  const decision = await enforceAuthRequest(event);
  return decision.kind === "allow" ? next() : decision.response;
};

const recordRequestTiming: StartMiddleware = async (event, next) => {
  const { startedTicks } = event.locals.requestContext;
  const response = await next();
  const duration = Math.round(performance.now() - startedTicks);

  response.headers.set("Server-Timing", `app;dur=${duration}`);

  return response;
};

// API routes are the GET/POST/... exports of modules under src/routes.
// `createAPIHandler` is fetch-style (request first) while the plugin hands every
// middleware the request event, so the event's request is passed through.
const handleApiRoutes = createAPIHandler(routes);

const serveApiRoutes: StartMiddleware = (event, next) =>
  handleApiRoutes(event.request, next);

export default [
  identifyRequest,
  applySecurityHeaders,
  resolveSession,
  authorizeRequest,
  recordRequestTiming,

  // Last, so every request above has already been identified, secured,
  // session-resolved, and authorized.
  serveApiRoutes,
] satisfies StartMiddleware[];
