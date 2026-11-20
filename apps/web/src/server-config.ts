import { captureException } from "@sentry/core";
import { createFlightDataCollector } from "@solidjs/router/server";
import { configureServerErrors, parseCookieHeader } from "@solidjs/web";
import { configureServerFunctionsServer } from "@solidjs/web/server-functions/server";

import { ActionError } from "~/contracts/errors";
import { SESSION_COOKIE_NAME } from "~/server/auth/session/cookies";
import { faultMeta } from "~/shared/observability/fault-meta";
import { createLogger } from "~/shared/observability/runtime-logger";

import { Router } from "./router";

const SAFE_ERROR_MESSAGE = "No se pudo completar la solicitud.";

const logger = createLogger("server-fault");

// Solid hears one error once per kind: a server function that fails during
// SSR is heard as `server-function`, then as `render`. It is reported once.
const reported = new WeakSet<object>();

function report(thrown: unknown, kind: string, handling: string): void {
  if (typeof thrown === "object" && thrown !== null) {
    if (reported.has(thrown)) {
      return;
    }
    reported.add(thrown);
  }
  logger.error("server_fault", { kind, handling, ...faultMeta(thrown) });
  captureException(thrown);
}

const collectFlightData = createFlightDataCollector(Router);

const sessionOf = (headers: Headers) =>
  parseCookieHeader(headers.get("cookie"))[SESSION_COOKIE_NAME];

configureServerFunctionsServer({
  // The single-flight collector: a mutation response carries the refreshed
  // query data for the page the client is about to show, so the router seeds
  // its cache instead of refetching. A mutation that changes the session
  // (sign-in, sign-out, impersonation) collects nothing: the request's
  // principal is the old one, and on Workers the new session lives in another
  // Durable Object. The client loads that page in a request of its own.
  collectFlightData: (event, outcome) =>
    sessionOf(outcome.request.headers) === sessionOf(outcome.foldedHeaders)
      ? collectFlightData(event, outcome)
      : undefined,
});

// Every failure the server runtime meets: a server function called over HTTP,
// in SSR or for single-flight data, and a render. Responses and expected
// `ActionError`s reach the client as thrown, so it can branch on kind and
// code. Anything else is reported and redacted, so an internal fault never
// reaches the browser as a message.
configureServerErrors({
  onError: (thrown, { kind, handling }) => {
    if (thrown instanceof Response) {
      return thrown;
    }
    if (thrown instanceof ActionError && thrown.wire.kind !== "internal") {
      return thrown;
    }
    report(thrown, kind, handling);
    // Still an ActionError: `wire` is an own property and survives
    // serialization, where a bare Error arrives with only its message.
    return new ActionError({
      kind: "internal",
      code: null,
      message: SAFE_ERROR_MESSAGE,
    });
  },
});
