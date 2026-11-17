import type { DomainError } from "~/domain/errors";
import type { UserId } from "~/domain/ids";
import type { ActorScope } from "~/server/capacity/application/actor-scope";
import { getDrawCapacitySnapshot } from "~/server/capacity/application/queries/get-draw-capacity-snapshot";
import type {
  DrawPolicyDefaultsRepo,
  DrawPolicyOverridesRepo,
} from "~/server/capacity/infrastructure/policy-repos";
import type {
  CapacityCommitsRepo,
  CapacityGrantsRepo,
  CapacityReservationsRepo,
} from "~/server/capacity/infrastructure/usage-repo";
import type { OperationContext } from "~/server/platform/operation/context";
import { isErr, Ok, type Result } from "~/shared/result";

import { computeNeededHolds } from "../domain/hold-demand";

export type HoldPlanRepos = {
  users: {
    findById(id: UserId): Promise<ActorScope | undefined>;
  };
  drawPolicyDefaults: DrawPolicyDefaultsRepo;
  drawPolicyOverrides: DrawPolicyOverridesRepo;
  drawCapacityGrants: CapacityGrantsRepo;
  drawUsageReservations: CapacityReservationsRepo;
  drawUsageCommits: CapacityCommitsRepo;
  contactHolds: {
    countActiveByUser(userId: UserId, activeAsOf: Date): Promise<number>;
  };
};

export type ContactHoldPlan = {
  requested: number;
};

export async function planContactHolds(
  actorUserId: UserId,
  repos: HoldPlanRepos,
  operation: OperationContext,
): Promise<Result<ContactHoldPlan, DomainError>> {
  const snapshotResult = await getDrawCapacitySnapshot(
    actorUserId,
    repos,
    operation,
  );
  if (isErr(snapshotResult)) {
    return snapshotResult;
  }

  return Ok({
    requested: computeNeededHolds(
      snapshotResult.value.activeHolds,
      snapshotResult.value.policy.bufferTarget,
    ),
  });
}
