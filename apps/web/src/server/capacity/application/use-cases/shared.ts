import type { CapacityRequestsRepo } from "~/server/capacity/infrastructure/capacity-requests-repo";
import type { CapacityTeamsRepo } from "~/server/capacity/infrastructure/capacity-teams-repo";
import type { CapacityUsersRepo } from "~/server/capacity/infrastructure/capacity-users-repo";
import type {
  DrawPolicyDefaultsRepo,
  DrawPolicyOverridesRepo,
  SearchPolicyDefaultsRepo,
  SearchPolicyOverridesRepo,
} from "~/server/capacity/infrastructure/policy-repos";
import type { CapacityGrantsRepo } from "~/server/capacity/infrastructure/usage-repo";
import type { AppUow } from "~/server/platform/database/uow";
import type { ActionRateLimiter } from "~/server/security/action-rate-limit";
import type { BranchSupervisorsRepo } from "~/server/users/repos-branch-supervisors";

export type CapacityRequestTx = {
  capacityRequests: Pick<
    CapacityRequestsRepo,
    "findById" | "markApproved" | "markRejected"
  >;
};

export type CapacityRequestCreateTx = {
  capacityRequests: Pick<CapacityRequestsRepo, "create">;
};

export type CapacityManageTx = {
  users: Pick<CapacityUsersRepo, "findById">;
};

export type CapacityGrantTx = {
  searchCapacityGrants: Pick<
    CapacityGrantsRepo,
    "insert" | "findByUserAndRange"
  >;
  drawCapacityGrants: Pick<CapacityGrantsRepo, "insert" | "findByUserAndRange">;
};

export type CapacityPolicyTx = {
  teams: Pick<CapacityTeamsRepo, "findById">;
  branchSupervisors: Pick<BranchSupervisorsRepo, "isSupervisor">;
  searchPolicyDefaults: Pick<SearchPolicyDefaultsRepo, "upsert">;
  drawPolicyDefaults: Pick<DrawPolicyDefaultsRepo, "upsert">;
  searchPolicyOverrides: Pick<SearchPolicyOverridesRepo, "replaceForUser">;
  drawPolicyOverrides: Pick<DrawPolicyOverridesRepo, "replaceForUser">;
};

export type CapacityApprovalDeps = {
  uow: AppUow<CapacityRequestTx & CapacityManageTx & CapacityGrantTx>;
  rateLimiter: ActionRateLimiter;
};

export type CapacityGrantDeps = {
  uow: AppUow<CapacityManageTx & CapacityGrantTx>;
};

export type CapacityPolicyDeps = {
  uow: AppUow<CapacityManageTx & CapacityPolicyTx>;
};

export type CapacityRequestDeps = {
  uow: AppUow<CapacityRequestCreateTx>;
  rateLimiter: ActionRateLimiter;
};
