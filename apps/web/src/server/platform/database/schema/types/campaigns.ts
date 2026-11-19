import type {
  CampaignId,
  CampaignRecordId,
  IdColumn,
  OrganizationId,
  UserId,
} from "~/domain/ids";

export interface CampaignsTable {
  id: IdColumn<CampaignId>;
  name: string;
  created_at: Date;
}

export interface CampaignRecordsTable {
  id: IdColumn<CampaignRecordId>;
  campaign_id: IdColumn<CampaignId>;
  organization_id: IdColumn<OrganizationId>;
  segment: string;
  facts: Record<string, string>;
  imported_at: Date;
  worked_at: Date | null;
}

export interface CampaignHoldsTable {
  id: string;
  record_id: IdColumn<CampaignRecordId>;
  user_id: IdColumn<UserId>;
  held_at: Date;
  released_at: Date | null;
}
