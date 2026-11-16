import { action } from "@solidjs/router";
import { respond } from "@solidjs/web";

import {
  drawCampaignBatch,
  importCampaignFile,
  markCampaignRecordWorked,
  releaseCampaignBatch,
} from "~/rpc/campaigns/actions";
import {
  campaignAvailabilityQuery,
  campaignsQuery,
  myCampaignBatchQuery,
} from "~/rpc/campaigns/queries";

const revalidateBatch = [
  myCampaignBatchQuery.key,
  campaignAvailabilityQuery.key,
];

export const importCampaignFileMutation = action(
  async (form: FormData) =>
    respond(await importCampaignFile(form), {
      revalidate: [campaignsQuery.key, campaignAvailabilityQuery.key],
    }),
  "importCampaignFile",
);

export const drawCampaignBatchMutation = action(
  async (input: { campaignId: string; segment?: string }) =>
    respond(await drawCampaignBatch(input), { revalidate: revalidateBatch }),
  "drawCampaignBatch",
);

export const releaseCampaignBatchMutation = action(
  async (campaignId: string) =>
    respond(await releaseCampaignBatch({ campaignId }), {
      revalidate: revalidateBatch,
    }),
  "releaseCampaignBatch",
);

export const markCampaignRecordWorkedMutation = action(
  async (recordId: string) =>
    respond(await markCampaignRecordWorked({ recordId }), {
      revalidate: revalidateBatch,
    }),
  "markCampaignRecordWorked",
);
