import { action } from "@solidjs/router";
import { respond } from "@solidjs/web";

import { CAMPAIGN_IMPORT_BATCH_LINES } from "~/contracts/campaigns/imports";
import type { CampaignImportView } from "~/contracts/campaigns/views";
import type { WireError } from "~/contracts/errors";
import {
  drawCampaignBatch,
  importCampaignTable,
  markCampaignRecordWorked,
  releaseCampaignBatch,
} from "~/rpc/campaigns/actions";
import {
  campaignAvailabilityQuery,
  campaignsQuery,
  myCampaignBatchQuery,
} from "~/rpc/campaigns/queries";
import { Ok, type Result } from "~/shared/result";
import type { TableBody } from "~/shared/table";

const revalidateBatch = [
  myCampaignBatchQuery.key,
  campaignAvailabilityQuery.key,
];

export type CampaignTableImport = {
  campaignName: string;
  segmentColumn: string;
  table: TableBody;
  onProgress: (sentLines: number) => void;
};

// Each batch is its own transaction, so a failed batch leaves the earlier
// ones imported; importing the file again upserts the same companies.
async function importBatches(
  input: CampaignTableImport,
): Promise<Result<CampaignImportView, WireError>> {
  const { columns, lines } = input.table;
  const total: CampaignImportView = {
    campaignId: "",
    imported: 0,
    rejected: [],
  };
  for (let at = 0; at < lines.length; at += CAMPAIGN_IMPORT_BATCH_LINES) {
    const batch = lines.slice(at, at + CAMPAIGN_IMPORT_BATCH_LINES);
    // Batches run in file order: a company listed twice keeps its later line,
    // and the first failure stops the import.
    // eslint-disable-next-line no-await-in-loop
    const result = await importCampaignTable({
      campaignName: input.campaignName,
      segmentColumn: input.segmentColumn,
      table: { columns, lines: batch },
    });
    if (!result.ok) {
      return result;
    }
    total.campaignId = result.value.campaignId;
    total.imported += result.value.imported;
    total.rejected.push(...result.value.rejected);
    input.onProgress(at + batch.length);
  }
  return Ok(total);
}

export const importCampaignTableMutation = action(
  async (input: CampaignTableImport) =>
    respond(await importBatches(input), {
      revalidate: [campaignsQuery.key, campaignAvailabilityQuery.key],
    }),
  "importCampaignTable",
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
  async (input: { recordId: string; outcomeId: string; notes: string }) =>
    respond(await markCampaignRecordWorked(input), {
      revalidate: revalidateBatch,
    }),
  "markCampaignRecordWorked",
);
