import type { CapacityReservationId, UserId } from "~/domain/ids";
import type { CapacityKind } from "~/server/capacity/domain/types";

export type { CapacityKind };

export type ReserveReason<K extends CapacityKind> = K extends "lead"
  ? "lead_refill" | "admin_grant_adjustment"
  : "direct_search" | "admin_grant_adjustment";

export interface UsageReservationsRepo {
  insert(values: {
    user_id: UserId;
    amount: number;
    reason: string;
    created_at: Date;
    updated_at: Date;
  }): Promise<{ id: CapacityReservationId }>;
  findById(id: CapacityReservationId): Promise<unknown>;
  updateStatus(
    id: CapacityReservationId,
    status: "committed" | "cancelled" | "expired",
    updatedAt: Date,
  ): Promise<void>;
  updateAmountAndStatus(
    id: CapacityReservationId,
    amount: number,
    status: "committed" | "cancelled" | "expired",
    updatedAt: Date,
  ): Promise<void>;
}

export interface UsageCommitsRepo {
  insert(values: {
    reservation_id: CapacityReservationId;
    amount: number;
    created_at: Date;
  }): Promise<void>;
}

export interface UsageGrantsRepo {
  insert(values: {
    user_id: UserId;
    amount: number;
    reason: string;
    actor_user_id: UserId;
    created_at: Date;
  }): Promise<void>;
}

export interface UsageLedgerRepos {
  reservations: UsageReservationsRepo;
  commits: UsageCommitsRepo;
  grants: UsageGrantsRepo;
}

export interface GrantUsageCapacityCommand<K extends CapacityKind> {
  kind: K;
  actorUserId: UserId;
  targetUserId: UserId;
  amount: number;
  reason: string;
}
