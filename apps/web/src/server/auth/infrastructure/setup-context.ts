import type { Kysely } from "kysely";

import type { AuthWorkspaces } from "~/server/auth/application/ports";
import { createAuthIdentitiesRepo } from "~/server/auth/identities";
import { createAuthThrottleRepo } from "~/server/auth/repos-auth-throttle";
import { createUserRecoveryCodesRepo } from "~/server/auth/repos-user-recovery-codes";
import { createUserTotpFactorsRepo } from "~/server/auth/repos-user-totp-factors";
import { createPlatformEventsWriter } from "~/server/event-logs/platform-events-repo";
import type { PlatformExecutor } from "~/server/platform/database/executor";
import type { PlatformDatabase } from "~/server/platform/database/types";
import { createExecutorUow } from "~/server/platform/database/uow";
import { createSessionRepository } from "~/server/sessions/repos-sessions";
import { createPasskeysRepo } from "~/server/users/repos-passkeys";
import { createWebauthnChallengesRepo } from "~/server/users/repos-webauthn-challenges";

export type AuthSetupRepos = ReturnType<typeof createAuthSetupBaseRepos> & {
  events: ReturnType<typeof createPlatformEventsWriter>;
};

function createAuthSetupBaseRepos(
  executor: PlatformExecutor,
  workspaces: AuthWorkspaces,
) {
  return {
    users: createAuthIdentitiesRepo(executor, workspaces),
    sessions: createSessionRepository(executor),
    passkeys: createPasskeysRepo(executor),
    webauthnChallenges: createWebauthnChallengesRepo(executor),
    authThrottle: createAuthThrottleRepo(executor),
    userTotpFactors: createUserTotpFactorsRepo(executor),
    userRecoveryCodes: createUserRecoveryCodesRepo(executor),
  };
}

export function createAuthSetupContext(
  executor: Kysely<PlatformDatabase>,
  workspaces: AuthWorkspaces,
) {
  return {
    repos: createAuthSetupBaseRepos(executor, workspaces),
    workspaces,
    uow: createExecutorUow(executor, (tx): AuthSetupRepos => ({
      ...createAuthSetupBaseRepos(tx, workspaces),
      events: createPlatformEventsWriter(tx),
    })),
  };
}

export type AuthSetupContext = ReturnType<typeof createAuthSetupContext>;
