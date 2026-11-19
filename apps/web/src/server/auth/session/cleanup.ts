import type { Kysely } from "kysely";

import { addMilliseconds } from "~/domain/time/clock";
import { AUTH_MAINTENANCE_RETENTION } from "~/server/auth/config";
import { createAuthEventsRepo } from "~/server/auth/repos-auth-events";
import { createAuthThrottleRepo } from "~/server/auth/repos-auth-throttle";
import type {
  PlatformDatabase,
  WorkspaceDatabase,
} from "~/server/platform/database/types";
import type { OperationContext } from "~/server/platform/operation/context";
import { createActionRateLimitsRepo } from "~/server/security/repos-action-rate-limits";
import { createRequestSessionsRepo } from "~/server/security/repos-request-sessions";
import { createSessionRepository } from "~/server/sessions/repos-sessions";
import { createWebauthnChallengesRepo } from "~/server/users/repos-webauthn-challenges";
import { createLogger } from "~/shared/observability/runtime-logger";

const logger = createLogger("session-cleanup");

type Sweep = (sweptAt: Date) => Promise<number>;

async function runSweeps(
  sweeps: Record<string, Sweep>,
  context: OperationContext,
): Promise<void> {
  await Promise.all(
    Object.entries(sweeps).map(async ([name, sweep]) => {
      try {
        const deleted = await sweep(context.operationAt);
        if (deleted > 0) {
          logger.info("stale_rows_deleted", { sweep: name, deleted });
        }
      } catch (error: unknown) {
        logger.error("cleanup_failed", { sweep: name, error });
      }
    }),
  );
}

export function runPlatformCleanupTick(
  db: Kysely<PlatformDatabase>,
  context: OperationContext,
): Promise<void> {
  const sessions = createSessionRepository(db);
  const requestSessions = createRequestSessionsRepo(db);
  const challenges = createWebauthnChallengesRepo(db);
  const throttle = createAuthThrottleRepo(db);
  const authEvents = createAuthEventsRepo(db);

  return runSweeps(
    {
      sessions: (at) => sessions.deleteExpired(at),
      request_sessions: (at) => requestSessions.deleteExpired(at),
      webauthn_challenges: (at) => challenges.deleteExpired(at),
      auth_throttle: async (at) =>
        (await throttle.deleteExpiredBlocks(at)) +
        (await throttle.deleteUpdatedBefore(
          addMilliseconds(at, -AUTH_MAINTENANCE_RETENTION.throttleMs),
        )),
      auth_events: (at) =>
        authEvents.deleteCreatedBefore(
          addMilliseconds(at, -AUTH_MAINTENANCE_RETENTION.eventsMs),
        ),
    },
    context,
  );
}

export function runWorkspaceCleanupTick(
  db: Kysely<WorkspaceDatabase>,
  context: OperationContext,
): Promise<void> {
  const rateLimits = createActionRateLimitsRepo(db);

  return runSweeps(
    {
      action_rate_limits: (at) =>
        rateLimits.deleteUpdatedBefore(
          addMilliseconds(at, -AUTH_MAINTENANCE_RETENTION.rateLimitsMs),
        ),
    },
    context,
  );
}
