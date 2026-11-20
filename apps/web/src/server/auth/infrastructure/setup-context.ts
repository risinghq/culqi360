import type { Kysely } from "kysely";

import type { AuthWorkspaces } from "~/server/auth/application/ports";
import { createAuthIdentitiesRepo } from "~/server/auth/identities";
import { createAuthThrottleRepo } from "~/server/auth/repos-auth-throttle";
import { createUserRecoveryCodesRepo } from "~/server/auth/repos-user-recovery-codes";
import { createUserTotpFactorsRepo } from "~/server/auth/repos-user-totp-factors";
import type { PlatformExecutor } from "~/server/platform/database/executor";
import type { PlatformDatabase } from "~/server/platform/database/types";
import { createExecutorUow } from "~/server/platform/database/uow";
import { createPasskeysRepo } from "~/server/users/repos-passkeys";
import { createWebauthnChallengesRepo } from "~/server/users/repos-webauthn-challenges";

export type AuthSetupRepos = ReturnType<typeof createAuthSetupRepos>;

function createAuthSetupRepos(
  executor: PlatformExecutor,
  workspaces: AuthWorkspaces,
) {
  return {
    users: createAuthIdentitiesRepo(executor, workspaces),
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
    repos: createAuthSetupRepos(executor, workspaces),
    workspaces,
    uow: createExecutorUow(executor, (tx) =>
      createAuthSetupRepos(tx, workspaces),
    ),
  };
}

export type AuthSetupContext = ReturnType<typeof createAuthSetupContext>;
