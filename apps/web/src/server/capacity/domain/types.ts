import type { BranchId, TeamId } from "~/domain/ids";

export type CapacityRequestKind = "search_extra" | "draw_refill";

export type PolicySource = "system" | "branch" | "team" | "user";

// A draw takes contacts from the engine into a user's holds.
export type CapacityKind = "search" | "draw";

export type ReservationStatus =
  | "pending"
  | "committed"
  | "cancelled"
  | "expired";

export type ScopeRef =
  | { kind: "branch"; scopeId: BranchId }
  | { kind: "team"; scopeId: TeamId };
