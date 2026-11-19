import type { AuthIdentitiesRepo } from "~/server/auth/identities";
import type { AuthEventsRepo } from "~/server/auth/repos-auth-events";
import type { AuthThrottleRepo } from "~/server/auth/repos-auth-throttle";
import type { LoginFlowsRepo } from "~/server/auth/repos-login-flows";
import type { UserTotpFactorsRepo } from "~/server/auth/repos-user-totp-factors";
import type { PlatformEventsWriter } from "~/server/event-logs/platform-events-repo";
import type { SessionRepository } from "~/server/sessions/repos-sessions";
import type { PasskeysRepo } from "~/server/users/repos-passkeys";
import type { WebauthnChallengesRepo } from "~/server/users/repos-webauthn-challenges";

export type PasskeyAuthRepos = {
  users: AuthIdentitiesRepo;
  sessions: SessionRepository;
  loginFlows: LoginFlowsRepo;
  passkeys: PasskeysRepo;
  webauthnChallenges: WebauthnChallengesRepo;
  events: PlatformEventsWriter;
  authThrottle: AuthThrottleRepo;
  authEvents: AuthEventsRepo;
  userTotpFactors: UserTotpFactorsRepo;
};

export type PasskeyAuthReadRepos = Omit<PasskeyAuthRepos, "events">;
