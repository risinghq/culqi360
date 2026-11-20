import type { AuthIdentitiesRepo } from "~/server/auth/identities";
import type { AuthEventsRepo } from "~/server/auth/repos-auth-events";
import type { AuthThrottleRepo } from "~/server/auth/repos-auth-throttle";
import type { LoginFlowsRepo } from "~/server/auth/repos-login-flows";
import type { UserTotpFactorsRepo } from "~/server/auth/repos-user-totp-factors";
import type { PasskeysRepo } from "~/server/users/repos-passkeys";
import type { WebauthnChallengesRepo } from "~/server/users/repos-webauthn-challenges";

export type PasskeyAuthRepos = {
  users: AuthIdentitiesRepo;
  loginFlows: LoginFlowsRepo;
  passkeys: PasskeysRepo;
  webauthnChallenges: WebauthnChallengesRepo;
  authThrottle: AuthThrottleRepo;
  authEvents: AuthEventsRepo;
  userTotpFactors: UserTotpFactorsRepo;
};
