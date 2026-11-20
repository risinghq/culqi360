import { normalizeColumn } from "~/shared/table";

export const CAMPAIGN_RUC_COLUMN = "ruc";
export const CAMPAIGN_LEGAL_NAME_COLUMN = "razon_social";

export const MAX_CAMPAIGN_FILE_LINES = 100_000;

/** Lines the browser sends per import call. Each call is one transaction on
 * the workspace's Durable Object, which serves nothing else while it runs,
 * so a batch stays well under 100 ms; the campaign bench measures one
 * batch. */
export const CAMPAIGN_IMPORT_BATCH_LINES = 1_000;

// Each client names its pool column differently: safeapp's file groups by
// `origen`. The import names it rather than the parser guessing.
export function isCampaignHeader(
  columns: readonly string[],
  segmentColumn: string,
): boolean {
  return (
    columns.includes(CAMPAIGN_RUC_COLUMN) &&
    columns.includes(normalizeColumn(segmentColumn))
  );
}
