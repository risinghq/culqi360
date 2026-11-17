import type { Transaction } from "kysely";

import { getExecutiveDetail } from "~/server/capacity/application/queries/get-executive-detail";
import { getPolicyDefaults } from "~/server/capacity/application/queries/get-policy-defaults";
import { listManagedExecutives } from "~/server/capacity/application/queries/list-managed-executives";
import { listPendingRequests } from "~/server/capacity/application/queries/list-pending-requests";
import { approveCapacityRequest } from "~/server/capacity/application/use-cases/approve-capacity-request";
import { grantDrawCapacityDirect } from "~/server/capacity/application/use-cases/grant-draw-capacity-direct";
import { grantSearchCapacityDirect } from "~/server/capacity/application/use-cases/grant-search-capacity-direct";
import { rejectCapacityRequest } from "~/server/capacity/application/use-cases/reject-capacity-request";
import { requestCapacity } from "~/server/capacity/application/use-cases/request-capacity";
import { updateExecutivePolicyOverride } from "~/server/capacity/application/use-cases/update-executive-policy-override";
import { updateScopePolicy } from "~/server/capacity/application/use-cases/update-scope-policy";
import { createCapacityRequestsRepo } from "~/server/capacity/infrastructure/capacity-requests-repo";
import { createCapacityTeamsRepo } from "~/server/capacity/infrastructure/capacity-teams-repo";
import { createCapacityUsersRepo } from "~/server/capacity/infrastructure/capacity-users-repo";
import {
  createDrawPolicyDefaultsRepo,
  createDrawPolicyOverridesRepo,
  createSearchPolicyDefaultsRepo,
  createSearchPolicyOverridesRepo,
} from "~/server/capacity/infrastructure/policy-repos";
import {
  createCapacityCommitsRepo,
  createCapacityGrantsRepo,
  createCapacityReservationsRepo,
} from "~/server/capacity/infrastructure/usage-repo";
import { createContactHoldsRepo } from "~/server/contacts/infrastructure/hold-repo";
import type { DatabaseExecutor } from "~/server/platform/database/executor";
import type { Database } from "~/server/platform/database/types";
import { createExecutorUow } from "~/server/platform/database/uow";
import type { ServerInfrastructure } from "~/server/platform/infrastructure";
import { createActionRateLimiter } from "~/server/security/action-rate-limit";
import { createBranchSupervisorsRepo } from "~/server/users/repos-branch-supervisors";

function createCapacityBaseRepos(executor: DatabaseExecutor) {
  return {
    users: createCapacityUsersRepo(executor),
    teams: createCapacityTeamsRepo(executor),
    branchSupervisors: createBranchSupervisorsRepo(executor),
    capacityRequests: createCapacityRequestsRepo(executor),
    searchPolicyDefaults: createSearchPolicyDefaultsRepo(executor),
    searchPolicyOverrides: createSearchPolicyOverridesRepo(executor),
    drawPolicyDefaults: createDrawPolicyDefaultsRepo(executor),
    drawPolicyOverrides: createDrawPolicyOverridesRepo(executor),
    searchCapacityGrants: createCapacityGrantsRepo(executor, "search"),
    searchUsageReservations: createCapacityReservationsRepo(executor, "search"),
    searchUsageCommits: createCapacityCommitsRepo(executor, "search"),
    drawCapacityGrants: createCapacityGrantsRepo(executor, "draw"),
    drawUsageReservations: createCapacityReservationsRepo(executor, "draw"),
    drawUsageCommits: createCapacityCommitsRepo(executor, "draw"),
    contactHolds: createContactHoldsRepo(executor),
  };
}

function createCapacityTransactionRepos(executor: Transaction<Database>) {
  return {
    ...createCapacityBaseRepos(executor),
  };
}

export function createCapacityRuntime(
  serverInfrastructure: ServerInfrastructure,
) {
  const readRepos = createCapacityBaseRepos(serverInfrastructure.db);
  const uow = createExecutorUow(serverInfrastructure.db, (txDb) =>
    createCapacityTransactionRepos(txDb),
  );
  const rateLimiter = createActionRateLimiter(serverInfrastructure.db);

  return {
    requestCapacity: (
      ctx: Parameters<typeof requestCapacity>[0],
      input: Parameters<typeof requestCapacity>[2],
    ) => requestCapacity(ctx, { uow, rateLimiter }, input),
    approveCapacityRequest: (
      ctx: Parameters<typeof approveCapacityRequest>[0],
      input: Parameters<typeof approveCapacityRequest>[2],
    ) => approveCapacityRequest(ctx, { uow, rateLimiter }, input),
    rejectCapacityRequest: (
      ctx: Parameters<typeof rejectCapacityRequest>[0],
      input: Parameters<typeof rejectCapacityRequest>[2],
    ) => rejectCapacityRequest(ctx, { uow, rateLimiter }, input),
    grantSearchCapacityDirect: (
      ctx: Parameters<typeof grantSearchCapacityDirect>[0],
      input: Parameters<typeof grantSearchCapacityDirect>[2],
    ) => grantSearchCapacityDirect(ctx, { uow }, input),
    grantDrawCapacityDirect: (
      ctx: Parameters<typeof grantDrawCapacityDirect>[0],
      input: Parameters<typeof grantDrawCapacityDirect>[2],
    ) => grantDrawCapacityDirect(ctx, { uow }, input),
    updateScopePolicy: (
      ctx: Parameters<typeof updateScopePolicy>[0],
      input: Parameters<typeof updateScopePolicy>[2],
    ) => updateScopePolicy(ctx, { uow }, input),
    updateExecutivePolicyOverride: (
      ctx: Parameters<typeof updateExecutivePolicyOverride>[0],
      input: Parameters<typeof updateExecutivePolicyOverride>[2],
    ) => updateExecutivePolicyOverride(ctx, { uow }, input),
    listManagedExecutives: (ctx: Parameters<typeof listManagedExecutives>[0]) =>
      listManagedExecutives(ctx, { repos: readRepos }),
    getExecutiveDetail: (
      ctx: Parameters<typeof getExecutiveDetail>[0],
      input: Parameters<typeof getExecutiveDetail>[2],
    ) => getExecutiveDetail(ctx, { repos: readRepos }, input),
    listPendingRequests: (ctx: Parameters<typeof listPendingRequests>[0]) =>
      listPendingRequests(ctx, { repos: readRepos }),
    getPolicyDefaults: (ctx: Parameters<typeof getPolicyDefaults>[0]) =>
      getPolicyDefaults(ctx, { repos: readRepos }),
  };
}
