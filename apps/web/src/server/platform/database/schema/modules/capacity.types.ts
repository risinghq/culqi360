import type { Generated } from "kysely";

import type {
  BranchId,
  CapacityRequestId,
  CapacityReservationId,
  GeneratedId,
  IdColumn,
  NullableIdColumn,
  TeamId,
  UserId,
} from "~/domain/ids";
import type { CapacityKind } from "~/server/capacity/domain/types";

export interface CapacityGrantsTable {
  id: Generated<string>;
  kind: CapacityKind;
  user_id: IdColumn<UserId>;
  amount: number;
  reason: string;
  actor_user_id: IdColumn<UserId>;
  created_at: Date;
}

export interface CapacityReservationsTable {
  id: GeneratedId<CapacityReservationId>;
  kind: CapacityKind;
  user_id: IdColumn<UserId>;
  amount: number;
  status: "pending" | "committed" | "cancelled" | "expired";
  reason: string;
  created_at: Date;
  updated_at: Date;
}

export interface CapacityCommitsTable {
  id: Generated<string>;
  reservation_id: IdColumn<CapacityReservationId>;
  amount: number;
  created_at: Date;
}

export interface CapacityRequestsTable {
  id: GeneratedId<CapacityRequestId>;
  user_id: IdColumn<UserId>;
  kind: "search_extra" | "draw_refill_extra";
  status: "pending" | "approved" | "rejected" | "canceled";
  requested_amount: number;
  reason: string;
  decision_note: string | null;
  reviewer_user_id: NullableIdColumn<UserId>;
  created_at: Date;
  updated_at: Date;
  decided_at: Date | null;
}

export interface DrawPolicyDefaultsTable {
  id: Generated<string>;
  scope_type: "branch" | "team";
  scope_id: IdColumn<BranchId | TeamId>;
  active_buffer_target: number;
  daily_refill_limit: number;
  created_at: Date;
  updated_at: Date;
}

export interface DrawPolicyOverridesTable {
  id: Generated<string>;
  user_id: IdColumn<UserId>;
  active_buffer_target: number;
  daily_refill_limit: number;
  effective_from: Date;
  expires_at: Date | null;
  set_by_user_id: IdColumn<UserId>;
  created_at: Date;
}

export interface SearchPolicyDefaultsTable {
  id: Generated<string>;
  scope_type: "branch" | "team";
  scope_id: IdColumn<BranchId | TeamId>;
  period_type: "month";
  search_limit: number;
  created_at: Date;
  updated_at: Date;
}

export interface SearchPolicyOverridesTable {
  id: Generated<string>;
  user_id: IdColumn<UserId>;
  search_limit: number;
  effective_from: Date;
  expires_at: Date | null;
  set_by_user_id: IdColumn<UserId>;
  created_at: Date;
}
