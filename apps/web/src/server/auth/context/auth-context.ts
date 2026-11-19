import type { AuthIdentity } from "~/server/auth/identities";
import type { AuthContextDeps } from "~/server/auth/types";
import type { OperationContext } from "~/server/platform/operation/context";

import {
  getStrongAuthStatus,
  type StrongAuthStatus,
} from "../security/strong-auth-status";

export type AuthContextUser = Pick<
  AuthIdentity,
  | "id"
  | "workspace_id"
  | "email"
  | "names"
  | "first_surname"
  | "second_surname"
  | "branch_id"
  | "role"
  | "username"
  | "onboarding_completed_at"
  | "is_active"
>;

export interface AuthContext {
  user: AuthContextUser;
  strongAuthStatus: StrongAuthStatus;
  recoveryCodesAcknowledgementRequired: boolean;
}

export async function loadActiveAuthContextForUser(
  user: AuthIdentity,
  deps: AuthContextDeps,
  operation: OperationContext,
): Promise<AuthContext | null> {
  if (!user.is_active) {
    return null;
  }
  if (user.expires_at !== null && user.expires_at <= operation.operationAt) {
    return null;
  }

  const [strongAuthStatus, recoveryCodeSet] = await Promise.all([
    getStrongAuthStatus(user.id, deps),
    deps.userRecoveryCodes.getActiveSet(user.id),
  ]);

  return {
    user,
    strongAuthStatus,
    recoveryCodesAcknowledgementRequired:
      recoveryCodeSet !== null && recoveryCodeSet.acknowledgedAt === null,
  };
}
