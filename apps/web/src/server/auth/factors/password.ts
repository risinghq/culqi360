import type {
  AuthIdentitiesRepo,
  AuthIdentity,
} from "~/server/auth/identities";
import { verifyPasswordLoginCredentials } from "~/server/auth/password/password-login";
import type { AuthProof } from "~/server/auth/policy/types";
import type { createAuthEventsRepo } from "~/server/auth/repos-auth-events";
import type { createAuthThrottleRepo } from "~/server/auth/repos-auth-throttle";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";

type PasswordProviderDeps = {
  users: AuthIdentitiesRepo;
  authThrottle: ReturnType<typeof createAuthThrottleRepo>;
  authEvents: ReturnType<typeof createAuthEventsRepo>;
};

interface AuthenticatedPassword {
  proof: Extract<AuthProof, { kind: "password" }>;
  user: AuthIdentity;
}

export async function authenticatePassword(
  input: {
    identifier: string;
    password: string;
    ipAddress: string;
  },
  deps: PasswordProviderDeps,
  operation: OperationContext,
): Promise<Result<AuthenticatedPassword, { kind: "invalid_credentials" }>> {
  const user = await verifyPasswordLoginCredentials(
    {
      username: input.identifier,
      password: input.password,
      ipAddress: input.ipAddress,
    },
    deps,
    operation,
  );
  if (!user.ok) {
    return Err({ kind: "invalid_credentials" });
  }

  return Ok({
    proof: {
      kind: "password",
      userId: user.value.id,
    },
    user: user.value,
  });
}
