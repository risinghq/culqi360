import type {
  BranchId,
  CallId,
  CampaignRecordId,
  CaseId,
  GeneratedId,
  IdColumn,
  NullableIdColumn,
  OrganizationId,
  OrganizationPersonId,
  UserId,
} from "~/domain/ids";

export type CallSource = "extension" | "manual" | "import";

export interface CallsTable {
  id: GeneratedId<CallId>;
  user_id: IdColumn<UserId>;
  branch_id: IdColumn<BranchId>;
  organization_id: IdColumn<OrganizationId>;
  campaign_record_id: NullableIdColumn<CampaignRecordId>;
  case_id: NullableIdColumn<CaseId>;
  organization_person_id: NullableIdColumn<OrganizationPersonId>;
  phone: string | null;
  source: CallSource;
  started_at: Date;
  ended_at: Date | null;
  duration_seconds: number | null;
  outcome: string | null;
  notes: string | null;
}
