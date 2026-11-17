import type { ColumnType } from "kysely";

import type {
  ActivityId,
  ActivityOutcomeId,
  BranchId,
  CampaignRecordId,
  CaseId,
  ContactId,
  GeneratedId,
  IdColumn,
  NullableIdColumn,
  OrganizationId,
  UserId,
} from "~/domain/ids";

export type ActivityChannel = "call" | "visit";

export type ActivitySource = "extension" | "manual" | "import";

export interface ActivityOutcomesTable {
  id: GeneratedId<ActivityOutcomeId>;
  label: string;
  channel: ActivityChannel;
  contacted: boolean | null;
  negotiated: boolean | null;
  callback: boolean | null;
  position: number;
  archived_at: Date | null;
  created_at: Date;
}

export interface ActivitiesTable {
  id: GeneratedId<ActivityId>;
  channel: ActivityChannel;
  user_id: IdColumn<UserId>;
  branch_id: IdColumn<BranchId>;
  organization_id: IdColumn<OrganizationId>;
  campaign_record_id: NullableIdColumn<CampaignRecordId>;
  case_id: NullableIdColumn<CaseId>;
  contact_id: NullableIdColumn<ContactId>;
  phone: string | null;
  source: ActivitySource;
  started_at: Date;
  ended_at: Date | null;
  duration_seconds: number | null;
  outcome_id: NullableIdColumn<ActivityOutcomeId>;
  notes: ColumnType<string | null, string | null | undefined, string | null>;
}
