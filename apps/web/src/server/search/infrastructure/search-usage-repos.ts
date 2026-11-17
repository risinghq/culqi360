import { createCapacityUsersRepo } from "~/server/capacity/infrastructure/capacity-users-repo";
import {
  createSearchPolicyDefaultsRepo,
  createSearchPolicyOverridesRepo,
} from "~/server/capacity/infrastructure/policy-repos";
import {
  createCapacityCommitsRepo,
  createCapacityGrantsRepo,
  createCapacityReservationsRepo,
} from "~/server/capacity/infrastructure/usage-repo";
import type { DatabaseExecutor } from "~/server/platform/database/executor";

export function buildSearchUsageRepos(executor: DatabaseExecutor) {
  return {
    users: createCapacityUsersRepo(executor),
    searchPolicyDefaults: createSearchPolicyDefaultsRepo(executor),
    searchPolicyOverrides: createSearchPolicyOverridesRepo(executor),
    searchCapacityGrants: createCapacityGrantsRepo(executor, "search"),
    searchUsageReservations: createCapacityReservationsRepo(executor, "search"),
    searchUsageCommits: createCapacityCommitsRepo(executor, "search"),
  };
}
