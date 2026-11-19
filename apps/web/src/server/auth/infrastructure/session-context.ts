import type { AuthWorkspaces } from "~/server/auth/application/ports";
import { createAuthIdentitiesRepo } from "~/server/auth/identities";
import { createUserTotpFactorsRepo } from "~/server/auth/repos-user-totp-factors";
import type { PlatformExecutor } from "~/server/platform/database/executor";
import { createPasskeysRepo } from "~/server/users/repos-passkeys";

export function createAuthSessionReadContext(
  executor: PlatformExecutor,
  workspaces: AuthWorkspaces,
) {
  return {
    repos: {
      users: createAuthIdentitiesRepo(executor, workspaces),
      passkeys: createPasskeysRepo(executor),
      userTotpFactors: createUserTotpFactorsRepo(executor),
    },
    workspaces,
  };
}

export type AuthSessionReadContext = ReturnType<
  typeof createAuthSessionReadContext
>;
