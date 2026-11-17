import type { Generated } from "kysely";

import type {
  CampaignId,
  CampaignRecordId,
  GeneratedId,
  IdColumn,
  OrganizationId,
  UserId,
} from "~/domain/ids";

export interface CampaignsTable {
  id: GeneratedId<CampaignId>;
  name: string;
  created_at: Date;
}

export interface CampaignRecordsTable {
  id: GeneratedId<CampaignRecordId>;
  campaign_id: IdColumn<CampaignId>;
  organization_id: IdColumn<OrganizationId>;
  segment: string;
  facts: Record<string, string>;
  imported_at: Date;
  worked_at: Date | null;
}

export interface CampaignHoldsTable {
  id: Generated<string>;
  record_id: IdColumn<CampaignRecordId>;
  user_id: IdColumn<UserId>;
  held_at: Date;
  released_at: Date | null;
}
