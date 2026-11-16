import { query } from "@solidjs/router";

import {
  getCampaignAvailability,
  getMyCampaignBatch,
  listCampaigns,
} from "~/server/campaigns/ui/queries";

export const campaignsQuery = query(async () => {
  "use server";
  return listCampaigns();
}, "campaigns.list");

export const myCampaignBatchQuery = query(async (campaignId: string) => {
  "use server";
  return getMyCampaignBatch({ campaignId });
}, "campaigns.held");

export const campaignAvailabilityQuery = query(async (campaignId: string) => {
  "use server";
  return getCampaignAvailability({ campaignId });
}, "campaigns.availability");
