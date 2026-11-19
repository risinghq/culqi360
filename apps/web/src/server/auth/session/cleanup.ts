import type { Kysely } from "kysely";

import { addMilliseconds } from "~/domain/time/clock";
import { AUTH_MAINTENANCE_RETENTION } from "~/server/auth/config";
import { createAuthEventsRepo } from "~/server/auth/repos-auth-events";
import { createAuthThrottleRepo } from "~/server/auth/repos-auth-throttle";
import { createLoginFlowsRepo } from "~/server/auth/repos-login-flows";
import { createPasswordResetTokensRepo } from "~/server/auth/repos-password-reset";
import type {
  PlatformDatabase,
  WorkspaceDatabase,
} from "~/server/platform/database/types";
import type { Duty } from "~/server/platform/schedule/schedule";
import { createActionRateLimitsRepo } from "~/server/security/repos-action-rate-limits";
import { createSessionRepository } from "~/server/sessions/repos-sessions";
import { createWebauthnChallengesRepo } from "~/server/users/repos-webauthn-challenges";
import { createLogger } from "~/shared/observability/runtime-logger";

const logger = createLogger("session-cleanup");

// Expired rows do no harm until they pile up, so cleanup runs at most hourly.
const CLEANUP_SPACING_MS = 60 * 60_000;

interface Sweep {
  // When the oldest row this sweep deletes becomes stale.
  nextAt(): Promise<Date | null>;
  sweep(sweptAt: Date): Promise<number>;
}

function retained(
  oldest: () => Promise<Date | null>,
  retentionMs: number,
): () => Promise<Date | null> {
  return async () => {
    const at = await oldest();
    return at && addMilliseconds(at, retentionMs);
  };
}

function cleanupDuty(name: string, sweeps: Record<string, Sweep>): Duty {
  const entries = Object.entries(sweeps);
  return {
    name,
    spacingMs: CLEANUP_SPACING_MS,

    async nextAt() {
      const times = await Promise.all(entries.map(([, s]) => s.nextAt()));
      const due = times.filter((time) => time !== null);
      return due.length === 0
        ? null
        : new Date(Math.min(...due.map((time) => time.getTime())));
    },

    // One table's failure does not keep the others from being cleaned.
    async run(context) {
      await Promise.all(
        entries.map(async ([sweep, table]) => {
          try {
            const deleted = await table.sweep(context.operationAt);
            if (deleted > 0) {
              logger.info("stale_rows_deleted", { sweep, deleted });
            }
          } catch (error: unknown) {
            logger.error("cleanup_failed", { sweep, error });
          }
        }),
      );
    },
  };
}

export function platformCleanupDuty(db: Kysely<PlatformDatabase>): Duty {
  const sessions = createSessionRepository(db);
  const challenges = createWebauthnChallengesRepo(db);
  const loginFlows = createLoginFlowsRepo(db);
  const resetTokens = createPasswordResetTokensRepo(db);
  const throttle = createAuthThrottleRepo(db);
  const authEvents = createAuthEventsRepo(db);
  const { throttleMs, eventsMs } = AUTH_MAINTENANCE_RETENTION;

  return cleanupDuty("platform-cleanup", {
    sessions: {
      nextAt: () => sessions.nextExpiryAt(),
      sweep: (at) => sessions.deleteExpired(at),
    },
    webauthn_challenges: {
      nextAt: () => challenges.nextExpiryAt(),
      sweep: (at) => challenges.deleteExpired(at),
    },
    login_flows: {
      nextAt: () => loginFlows.nextExpiryAt(),
      sweep: (at) => loginFlows.deleteExpired(at),
    },
    password_reset_tokens: {
      nextAt: () => resetTokens.nextExpiryAt(),
      sweep: (at) => resetTokens.deleteExpired(at),
    },
    auth_throttle_blocks: {
      nextAt: () => throttle.nextBlockEndAt(),
      sweep: (at) => throttle.deleteExpiredBlocks(at),
    },
    auth_throttle_idle: {
      nextAt: retained(() => throttle.oldestUpdatedAt(), throttleMs),
      sweep: (at) =>
        throttle.deleteUpdatedBefore(addMilliseconds(at, -throttleMs)),
    },
    auth_events: {
      nextAt: retained(() => authEvents.oldestCreatedAt(), eventsMs),
      sweep: (at) =>
        authEvents.deleteCreatedBefore(addMilliseconds(at, -eventsMs)),
    },
  });
}

export function workspaceCleanupDuty(db: Kysely<WorkspaceDatabase>): Duty {
  const rateLimits = createActionRateLimitsRepo(db);
  const { rateLimitsMs } = AUTH_MAINTENANCE_RETENTION;

  return cleanupDuty("workspace-cleanup", {
    action_rate_limits: {
      nextAt: retained(() => rateLimits.oldestUpdatedAt(), rateLimitsMs),
      sweep: (at) =>
        rateLimits.deleteUpdatedBefore(addMilliseconds(at, -rateLimitsMs)),
    },
  });
}
