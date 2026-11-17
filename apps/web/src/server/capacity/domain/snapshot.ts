import {
  remainingCapacity,
  sumAmount,
  sumPending,
} from "~/server/capacity/domain/math";
import type { ReservationStatus } from "~/server/capacity/domain/types";

import type { DrawPolicy, SearchPolicy } from "./policy";

type GrantRow = { amount: number };
type CommitRow = { amount: number };
type ReservationRow = { amount: number; status: ReservationStatus };

export interface SearchCapacitySnapshot {
  policy: SearchPolicy;
  granted: number;
  committed: number;
  pending: number;
  remaining: number;
}

export interface DrawCapacitySnapshot {
  policy: DrawPolicy;
  granted: number;
  committed: number;
  pending: number;
  remaining: number;
  activeHolds: number;
}

export function buildSearchCapacitySnapshot(input: {
  policy: SearchPolicy;
  grants: GrantRow[];
  commits: CommitRow[];
  reservations: ReservationRow[];
}): SearchCapacitySnapshot {
  const granted = sumAmount(input.grants);
  const committed = sumAmount(input.commits);
  const pending = sumPending(input.reservations);
  const remaining = remainingCapacity({
    limit: input.policy.monthlyLimit,
    granted,
    committed,
    pending,
  });

  return {
    policy: input.policy,
    granted,
    committed,
    pending,
    remaining,
  };
}

export function buildDrawCapacitySnapshot(input: {
  policy: DrawPolicy;
  grants: GrantRow[];
  commits: CommitRow[];
  reservations: ReservationRow[];
  activeHolds: number;
}): DrawCapacitySnapshot {
  const granted = sumAmount(input.grants);
  const committed = sumAmount(input.commits);
  const pending = sumPending(input.reservations);
  const remaining = remainingCapacity({
    limit: input.policy.dailyLimit,
    granted,
    committed,
    pending,
  });

  return {
    policy: input.policy,
    granted,
    committed,
    pending,
    remaining,
    activeHolds: input.activeHolds,
  };
}
