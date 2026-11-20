import type { Generated } from "kysely";

import type { Json } from "~/contracts/json";
import type {
  BranchId,
  CommissionSchemeVersionId,
  GpvSnapshotId,
  GpvSnapshotIssueId,
  GpvSnapshotPlacementId,
  IdColumn,
  MerchantMonthCreditAdjustmentId,
  NullableIdColumn,
  OrganizationId,
  UserId,
} from "~/domain/ids";
import type {
  GpvSnapshotIssueResolution,
  GpvSnapshotState,
} from "~/domain/merchant-stats/snapshot";

export type GpvSnapshotIssueSeverity = "warning" | "blocking";
export type GpvSnapshotIssueStatus = "open" | "resolved";

// Columns ending in _on and the month columns hold YYYY-MM-DD strings.

export interface GpvSnapshotsTable {
  id: IdColumn<GpvSnapshotId>;
  content_sha256: string;
  cut_at: Date;
  revision: number;
  state: Generated<GpvSnapshotState>;
  uploaded_by: IdColumn<UserId>;
  uploaded_at: Date;
  activated_by: NullableIdColumn<UserId>;
  activated_at: Date | null;
}

export interface MerchantGpvDatasetTable {
  id: "default";
  updated_at: Date;
}

export interface GpvSnapshotPlacementsTable {
  id: IdColumn<GpvSnapshotPlacementId>;
  snapshot_id: IdColumn<GpvSnapshotId>;
  row_number: number;
  placement_key: string;
  merchant_id: string;
  product: string;
  serial_number: string | null;
  ruc: string;
  sold_on: string;
  sale_month: string;
  trade_name: string | null;
  legal_name: string | null;
  culqi_user_code: string | null;
  culqi_user_name: string | null;
  mesa: string | null;
  channel: string | null;
  subchannel: string | null;
  offer_amount: number | null;
  promotion: string | null;
  client_type: string | null;
  stock_type: string | null;
  trial_on: string | null;
  activated_on: string | null;
  last_transaction_on: string | null;
  m0_plus_15d_gpv: number | null;
  m0_plus_15d_trx: number | null;
  raw: Json;
}

export interface GpvSnapshotObservationsTable {
  snapshot_id: IdColumn<GpvSnapshotId>;
  placement_id: IdColumn<GpvSnapshotPlacementId>;
  month_offset: number;
  sale_month: string;
  // A stored generated column: SQLite computes it and rejects writes.
  realized_month: Generated<string>;
  gpv: number;
  trx: number;
}

export interface GpvSnapshotIssuesTable {
  id: IdColumn<GpvSnapshotIssueId>;
  snapshot_id: IdColumn<GpvSnapshotId>;
  issue_key: string;
  issue_type: string;
  entity_key: string | null;
  severity: GpvSnapshotIssueSeverity;
  status: Generated<GpvSnapshotIssueStatus>;
  detail: string;
  previous_value: Json | null;
  candidate_value: Json | null;
  resolution: GpvSnapshotIssueResolution | null;
  resolved_by: NullableIdColumn<UserId>;
  resolved_at: Date | null;
  created_at: Date;
}

export interface MerchantMonthCreditsTable {
  ruc: string;
  month: string;
  organization_id: IdColumn<OrganizationId>;
  seller_user_id: IdColumn<UserId>;
  branch_id: NullableIdColumn<BranchId>;
  first_snapshot_id: IdColumn<GpvSnapshotId>;
  credited_at: Date;
}

export interface MerchantMonthCreditAdjustmentsTable {
  id: IdColumn<MerchantMonthCreditAdjustmentId>;
  ruc: string;
  month: string;
  seller_user_id: NullableIdColumn<UserId>;
  branch_id: NullableIdColumn<BranchId>;
  reason: string;
  adjusted_by: IdColumn<UserId>;
  adjusted_at: Date;
}

export interface CommissionSchemeVersionsTable {
  id: IdColumn<CommissionSchemeVersionId>;
  starts_on: string;
  rules: Json;
  set_by: IdColumn<UserId>;
  set_at: Date;
}

export interface MerchantGpvTargetsTable {
  organization_id: IdColumn<OrganizationId>;
  starts_on: string;
  monthly_target_gpv: number | null;
  set_by: IdColumn<UserId>;
  set_at: Date;
}

export interface MerchantSalesView {
  id: IdColumn<GpvSnapshotPlacementId>;
  merchant_id: string;
  product: string;
  serial_number: string | null;
  ruc: string;
  sold_on: string;
  sale_month: string;
  trade_name: string | null;
  legal_name: string | null;
  culqi_user_code: string | null;
  culqi_user_name: string | null;
  mesa: string | null;
  channel: string | null;
  subchannel: string | null;
  offer_amount: number | null;
  promotion: string | null;
  client_type: string | null;
  stock_type: string | null;
  trial_on: string | null;
  activated_on: string | null;
  last_transaction_on: string | null;
  m0_plus_15d_gpv: number | null;
  m0_plus_15d_trx: number | null;
}

export interface MerchantSaleGpvView {
  sale_id: IdColumn<GpvSnapshotPlacementId>;
  month_offset: number;
  sale_month: string;
  realized_month: string;
  gpv: number;
  trx: number;
}

export interface MerchantMonthlyGpvView {
  ruc: string;
  month: string;
  gpv: number;
  trx: number;
  device_count: number;
}

export interface MerchantMonthCreditView {
  ruc: string;
  month: string;
  organization_id: IdColumn<OrganizationId>;
  seller_user_id: NullableIdColumn<UserId>;
  branch_id: NullableIdColumn<BranchId>;
  method: "crm_owner" | "manual";
  confidence: "exact" | "none";
  first_snapshot_id: IdColumn<GpvSnapshotId>;
  derived_at: Date;
  resolved_by: NullableIdColumn<UserId>;
  resolved_at: Date | null;
}
