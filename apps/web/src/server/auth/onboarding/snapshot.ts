import type { OnboardingSnapshot } from "~/contracts/auth";
import { fail, type DomainError } from "~/domain/errors";
import type { UserId, WorkspaceId } from "~/domain/ids";
import type { AuthWorkspaces } from "~/server/auth/application/ports";
import { requiresStrongAuthRole } from "~/server/auth/policy/rules/role";
import { getStrongAuthStatus } from "~/server/auth/security/strong-auth-status";
import { Err, Ok, type Result } from "~/shared/result";

import type { AuthSetupRepos } from "../infrastructure/setup-context";

export interface OnboardingSnapshotDeps {
  repos: Pick<AuthSetupRepos, "users" | "passkeys" | "userTotpFactors">;
  workspaces: Pick<AuthWorkspaces, "findPhone">;
}

export async function loadOnboardingSnapshot(
  deps: OnboardingSnapshotDeps,
  member: { userId: UserId; workspaceId: WorkspaceId },
): Promise<Result<OnboardingSnapshot, DomainError>> {
  const [user, phone, strongAuth] = await Promise.all([
    deps.repos.users.findById(member.userId, member.workspaceId),
    deps.workspaces.findPhone(member.workspaceId, member.userId),
    getStrongAuthStatus(member.userId, deps.repos),
  ]);
  if (!user) {
    return Err(fail("user_not_found"));
  }

  return Ok({
    user: {
      email: user.email,
      names: user.names,
      firstSurname: user.first_surname,
      secondSurname: user.second_surname,
      role: user.role,
      phone,
    },
    passwordChangeRequired: user.password_change_required,
    strongAuthRequired: requiresStrongAuthRole(user.role),
    hasPasskey: strongAuth.hasPasskey,
    totpEnabled: strongAuth.hasTotp,
  });
}
