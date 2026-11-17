export type CampaignView = {
  id: string;
  name: string;
  createdAt: number;
};

export type SegmentAvailabilityView = {
  segment: string;
  available: number;
};

export type HeldCampaignRecordView = {
  id: string;
  organizationId: string;
  ruc: string;
  legalName: string | null;
  segment: string;
  facts: Record<string, string>;
};

export type CampaignImportView = {
  campaignId: string;
  imported: number;
  rejected: { line: number; message: string }[];
};
