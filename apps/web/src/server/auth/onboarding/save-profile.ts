import type { OnboardingSnapshot } from "~/contracts/auth";
import { fail, type DomainError } from "~/domain/errors";
import type { UserId, WorkspaceId } from "~/domain/ids";
import type { Phone } from "~/domain/phone/pe-mobile";
import type { AuthSetupContext } from "~/server/auth/infrastructure/setup-context";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, type Result } from "~/shared/result";

import { loadOnboardingSnapshot } from "./snapshot";

export async function saveOnboardingProfile(
  deps: AuthSetupContext,
  input: {
    userId: UserId;
    workspaceId: WorkspaceId;
    phone: Phone;
  },
  operation: OperationContext,
): Promise<Result<OnboardingSnapshot, DomainError>> {
  const user = await deps.repos.users.findById(input.userId, input.workspaceId);
  if (!user) {
    return Err(fail("user_not_found"));
  }
  if (user.onboarding_completed_at) {
    return Err(fail("invalid_input"));
  }

  const claim = await deps.workspaces.claimPhone(input.workspaceId, {
    accountId: input.userId,
    phone: input.phone,
    claimedAt: operation.operationAt,
  });
  if (claim.kind === "already_claimed") {
    return Err(fail("phone_in_use"));
  }

  return loadOnboardingSnapshot(deps, input);
}
