import type { AuthIdentity } from "~/server/auth/identities";
import { requiresStrongAuthRole } from "~/server/auth/policy/rules/role";

export interface FactorRemovalPolicyInput {
  role: AuthIdentity["role"];
  removingTotp: boolean;
  removingPasskeys: boolean;
  hasTotp: boolean;
  hasPasskey: boolean;
}

export function canRemoveStrongAuthFactor(
  input: FactorRemovalPolicyInput,
): boolean {
  if (!requiresStrongAuthRole(input.role)) {
    return true;
  }

  return (
    (input.hasTotp && !input.removingTotp) ||
    (input.hasPasskey && !input.removingPasskeys)
  );
}
