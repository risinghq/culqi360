import type { Kysely } from "kysely";

import type { AuthWorkspaces } from "~/server/auth/application/ports";
import type { AuthLoginRepos } from "~/server/auth/flows/login-deps";
import { createAuthIdentitiesRepo } from "~/server/auth/identities";
import { createAuthEventsRepo } from "~/server/auth/repos-auth-events";
import { createAuthThrottleRepo } from "~/server/auth/repos-auth-throttle";
import { createLoginFlowsRepo } from "~/server/auth/repos-login-flows";
import { createOAuthAccountsRepo } from "~/server/auth/repos-oauth-accounts";
import { createUserRecoveryCodesRepo } from "~/server/auth/repos-user-recovery-codes";
import { createUserTotpFactorsRepo } from "~/server/auth/repos-user-totp-factors";
import { createPlatformEventsWriter } from "~/server/event-logs/platform-events-repo";
import type { PlatformExecutor } from "~/server/platform/database/executor";
import type { PlatformDatabase } from "~/server/platform/database/types";
import { createExecutorUow } from "~/server/platform/database/uow";
import { createSessionRepository } from "~/server/sessions/repos-sessions";
import { createPasskeysRepo } from "~/server/users/repos-passkeys";
import { createWebauthnChallengesRepo } from "~/server/users/repos-webauthn-challenges";

function createAuthLoginBaseRepos(
  executor: PlatformExecutor,
  workspaces: AuthWorkspaces,
) {
  return {
    oauthAccounts: createOAuthAccountsRepo(executor),
    loginFlows: createLoginFlowsRepo(executor),
    users: createAuthIdentitiesRepo(executor, workspaces),
    sessions: createSessionRepository(executor),
    authThrottle: createAuthThrottleRepo(executor),
    authEvents: createAuthEventsRepo(executor),
    userTotpFactors: createUserTotpFactorsRepo(executor),
    userRecoveryCodes: createUserRecoveryCodesRepo(executor),
    passkeys: createPasskeysRepo(executor),
    webauthnChallenges: createWebauthnChallengesRepo(executor),
  };
}

export function createAuthLoginContext(
  executor: Kysely<PlatformDatabase>,
  workspaces: AuthWorkspaces,
) {
  return {
    repos: createAuthLoginBaseRepos(executor, workspaces),
    workspaces,
    uow: createExecutorUow(executor, (tx): AuthLoginRepos => ({
      ...createAuthLoginBaseRepos(tx, workspaces),
      events: createPlatformEventsWriter(tx),
    })),
  };
}

export type AuthLoginContext = ReturnType<typeof createAuthLoginContext>;
