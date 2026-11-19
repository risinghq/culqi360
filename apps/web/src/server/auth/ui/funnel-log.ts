import type { AuthFunnelClientEventPayload } from "~/domain/observability/auth-funnel";
import { getActionRequestContext } from "~/server/platform/observability/context";
import { createLogger } from "~/shared/observability/runtime-logger";

/** A sign-in step the server decided, as opposed to what the browser reports. */
export type AuthFunnelServerOutcome =
  | {
      kind: "password_result";
      outcome: "failed";
      code: string;
    }
  | {
      kind: "password_result";
      outcome: "succeeded" | "totp_required" | "passkey_required";
    }
  | {
      kind: "passkey_start_result" | "totp_result" | "passkey_result";
      outcome: "failed";
      code: string;
    }
  | {
      kind: "passkey_start_result";
      outcome: "started";
    }
  | {
      kind: "totp_result" | "passkey_result";
      outcome: "succeeded";
    };

// The funnel is read from the Worker's logs; nothing stores it.
const logger = createLogger("auth-funnel");

function logFunnelEvent(
  source: "client" | "server",
  event: AuthFunnelClientEventPayload | AuthFunnelServerOutcome,
): void {
  const request = getActionRequestContext();

  logger.info("auth_funnel_event", {
    source,
    ...event,
    traceId: request.traceId,
    requestId: request.requestId,
    routePath: request.routePath,
  });
}

export function logAuthClientEvent(event: AuthFunnelClientEventPayload): void {
  logFunnelEvent("client", event);
}

export function logAuthOutcome(outcome: AuthFunnelServerOutcome): void {
  logFunnelEvent("server", outcome);
}
