import {
  hasPermission,
  type PermissionHolder,
} from "~/domain/auth/access/rbac";
import { forbidden, type DomainError } from "~/domain/errors";
import type { BranchId } from "~/domain/ids";
import { Err, Ok, type Result } from "~/shared/result";

import type { LeadSourcingPolicyRepository } from "../sourcing-policy-repo";

export async function getSourcingPolicy(
  deps: {
    sourcingPolicies: LeadSourcingPolicyRepository;
  },
  input: {
    actor: PermissionHolder;
    branchId: BranchId;
  },
): Promise<
  Result<
    {
      branchId: string;
      engineAssignmentEnabled: boolean;
    },
    DomainError
  >
> {
  if (!hasPermission(input.actor, "capacity:policy:manage")) {
    return Err(forbidden());
  }

  const current = await deps.sourcingPolicies.findByBranchId(input.branchId);

  return Ok({
    branchId: input.branchId,
    engineAssignmentEnabled: current?.engineAssignmentEnabled === true,
  });
}
