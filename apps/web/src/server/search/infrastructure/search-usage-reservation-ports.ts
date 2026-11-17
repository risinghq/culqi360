import { getSearchCapacitySnapshot } from "~/server/capacity/application/queries/get-search-capacity-snapshot";
import type { UsageReservationPorts } from "~/server/capacity/application/usage/ledger";
import {
  createCapacityCommitsRepo,
  createCapacityReservationsRepo,
} from "~/server/capacity/infrastructure/usage-repo";
import type { DatabaseExecutor } from "~/server/platform/database/executor";
import { isErr, Ok } from "~/shared/result";

import { buildSearchUsageRepos } from "./search-usage-repos";

export function createSearchUsageReservationPorts(
  executor: DatabaseExecutor,
): UsageReservationPorts {
  return {
    executor,
    async checkRemaining(tx, actorUserId, operation) {
      const snapshot = await getSearchCapacitySnapshot(
        actorUserId,
        buildSearchUsageRepos(tx),
        operation,
      );
      if (isErr(snapshot)) {
        return snapshot;
      }
      return Ok(snapshot.value.remaining);
    },
    reservations: (tx) => createCapacityReservationsRepo(tx, "search"),
    commits: (tx) => createCapacityCommitsRepo(tx, "search"),
  };
}
