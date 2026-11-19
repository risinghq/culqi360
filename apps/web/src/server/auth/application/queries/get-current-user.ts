import type { CurrentUserView } from "~/contracts/auth";
import type { DomainError } from "~/domain/errors";
import { requiresStrongAuthRole } from "~/server/auth/policy/rules/role";
import { getStrongAuthStatus } from "~/server/auth/security/strong-auth-status";
import type { AppContext } from "~/server/platform/action/context";
import { Ok, type Result } from "~/shared/result";

import type { AuthSessionReadContext } from "../../infrastructure/session-context";

export async function getCurrentUser(
  ctx: AppContext,
  deps: AuthSessionReadContext,
): Promise<Result<CurrentUserView | null, DomainError>> {
  const {
    userId,
    workspaceId,
    role,
    sessionClass,
    primaryAuthMethod,
    strongAuthMethod,
  } = ctx.actor;

  const user = await deps.repos.users.findById(userId, workspaceId);
  if (!user) {
    return Ok(null);
  }

  const [strongAuthStatus, phone] = await Promise.all([
    getStrongAuthStatus(userId, deps.repos),
    deps.workspaces.findPhone(workspaceId, userId),
  ]);

  return Ok({
    id: user.id,
    email: user.email,
    names: user.names,
    firstSurname: user.first_surname,
    secondSurname: user.second_surname,
    phone,
    avatarUrl: user.avatar_storage_key
      ? `/api/me/avatar?v=${user.avatar_version}`
      : null,
    avatarVersion: user.avatar_version,
    onboardingCompletedAt: user.onboarding_completed_at?.getTime() ?? null,
    passwordChangeRequired: user.password_change_required,
    role,
    roleName: ctx.actor.roleName,
    permissions: ctx.actor.permissions,
    modules: ctx.actor.modules,
    strongAuthRequired: requiresStrongAuthRole(user.role),
    strongAuthConfigured: strongAuthStatus.hasVerifiedStrongAuth,
    totpEnabled: strongAuthStatus.hasTotp,
    hasPasskey: strongAuthStatus.hasPasskey,
    passkeyCount: strongAuthStatus.passkeyCount,
    sessionClass,
    primaryAuthMethod,
    strongAuthMethod,
    branchId: user.branch_id,
    impersonating: ctx.actor.impersonatorUserId !== null,
  });
}
