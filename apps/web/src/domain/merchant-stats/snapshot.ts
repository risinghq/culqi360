export type GpvSnapshotState =
  | "staging"
  | "needs_review"
  | "ready"
  | "active"
  | "superseded"
  | "rejected";

export type GpvSnapshotIssueResolution =
  | "accept_candidate"
  | "keep_previous"
  | "exclude_candidate"
  | "reject_snapshot";
