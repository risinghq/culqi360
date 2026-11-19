import type { WireError, WireKind } from "~/contracts/errors";
import type { Role } from "~/domain/auth/access/rbac";
import type { UserId } from "~/domain/ids";

import type { AppContext } from "./context";

// One line per action in the platform's logs. Written on every request, so it
// never goes to a store: that would spend the daily write allowance.
export interface ActionObservation {
  traceId: string;
  requestId: string;
  routePath: string | null;
  httpMethod: string | null;
  actionName: string;
  actorUserId: UserId | null;
  actorRole: Role | null;
  status: "ok" | "error";
  durationMs: number;
  errorCode: WireKind | null;
  errorMessage: string | null;
  input: TelemetryFields;
  createdAt: Date;
}

// Scalar identifiers only (lead ids, venue ids, counts, flags). Raw request
// payloads (which may carry PII or bank data) cannot be assigned here.
export type TelemetryFields = Record<string, string | number | boolean | null>;

export type TelemetryContext = {
  actionName: string;
  ctx: AppContext;
  /** Monotonic reading from `performance.now()`, taken when the action began. */
  startedTicks: number;
  telemetry: TelemetryFields;
};

function baseRow(
  t: TelemetryContext,
): Omit<ActionObservation, "status" | "errorCode" | "errorMessage"> {
  return {
    traceId: t.ctx.traceId,
    requestId: t.ctx.requestId,
    routePath: null,
    httpMethod: null,
    actionName: t.actionName,
    actorUserId: t.ctx.actor.userId,
    actorRole: t.ctx.actor.role,
    // Elapsed time comes from the monotonic timer so an NTP step mid-request
    // cannot produce a negative or absurd duration. The row itself is stamped
    // with the operation instant, which keeps every row from one request
    // correlated on a single timestamp.
    durationMs: Math.round(performance.now() - t.startedTicks),
    input: t.telemetry,
    createdAt: t.ctx.operationAt,
  };
}

export function successRow(t: TelemetryContext): ActionObservation {
  return { ...baseRow(t), status: "ok", errorCode: null, errorMessage: null };
}

export function errorRow(
  t: TelemetryContext,
  error: WireError,
): ActionObservation {
  return {
    ...baseRow(t),
    status: "error",
    errorCode: error.kind,
    errorMessage: error.message,
  };
}
