import type { DomainError } from "~/domain/errors";
import type { UserId } from "~/domain/ids";
import { appCalendarDateAt, appDayRange } from "~/domain/time/app-time";
import {
  buildDrawCapacitySnapshot,
  type DrawCapacitySnapshot,
} from "~/server/capacity/domain/snapshot";
import type {
  CapacityCommitsRepo,
  CapacityGrantsRepo,
  CapacityReservationsRepo,
} from "~/server/capacity/infrastructure/usage-repo";
import type { OperationContext } from "~/server/platform/operation/context";
import { Ok, type Result } from "~/shared/result";

import type { ActorScope } from "../actor-scope";
import { getEffectiveDrawPolicy } from "../resolve-draw-policy";

interface SnapshotRepos {
  users: {
    findById(id: UserId): Promise<ActorScope | undefined>;
  };
  drawPolicyDefaults: Parameters<
    typeof getEffectiveDrawPolicy
  >[1]["drawPolicyDefaults"];
  drawPolicyOverrides: Parameters<
    typeof getEffectiveDrawPolicy
  >[1]["drawPolicyOverrides"];
  drawCapacityGrants: CapacityGrantsRepo;
  drawUsageReservations: CapacityReservationsRepo;
  drawUsageCommits: CapacityCommitsRepo;
  contactAssignments: {
    countActiveByUser(userId: UserId, activeAsOf: Date): Promise<number>;
  };
}

export async function getDrawCapacitySnapshot(
  userId: UserId,
  repos: SnapshotRepos,
  operation: OperationContext,
): Promise<Result<DrawCapacitySnapshot, DomainError>> {
  const policyResult = await getEffectiveDrawPolicy(userId, repos, operation);
  if (!policyResult.ok) {
    return policyResult;
  }

  const range = appDayRange(appCalendarDateAt(operation.operationAt));
  const [grants, reservations, commits, activeAssignments] = await Promise.all([
    repos.drawCapacityGrants.findByUserAndRange(userId, range),
    repos.drawUsageReservations.findByUserAndRange(userId, range),
    repos.drawUsageCommits.findByUserAndRange(userId, range),
    repos.contactAssignments.countActiveByUser(userId, operation.operationAt),
  ]);

  return Ok(
    buildDrawCapacitySnapshot({
      policy: policyResult.value,
      grants,
      reservations,
      commits,
      activeAssignments,
    }),
  );
}

export type { DrawCapacitySnapshot };
