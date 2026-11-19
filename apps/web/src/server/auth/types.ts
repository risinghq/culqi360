import type { UserId, WorkspaceId } from "~/domain/ids";
import type { AuthIdentity } from "~/server/auth/identities";

import type {
  StrongAuthPasskeysPort,
  StrongAuthTotpFactorsPort,
} from "./security/strong-auth-status";

export interface AuthContextUsersPort {
  findById(
    userId: UserId,
    workspaceId?: WorkspaceId,
  ): Promise<AuthIdentity | undefined>;
}

export interface AuthContextDeps {
  users: AuthContextUsersPort;
  passkeys: StrongAuthPasskeysPort;
  userTotpFactors: StrongAuthTotpFactorsPort;
  userRecoveryCodes: {
    getActiveSet(
      userId: UserId,
    ): Promise<{ acknowledgedAt: Date | null } | null>;
  };
}
