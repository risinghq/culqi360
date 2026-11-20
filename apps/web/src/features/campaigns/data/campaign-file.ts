import { readTableFile, type TableFileRead } from "~/browser/files/table";
import {
  isCampaignHeader,
  MAX_CAMPAIGN_FILE_LINES,
} from "~/contracts/campaigns/imports";

/** Reads a campaign file in the browser and finds the table under its RUC
 * and segment header. The server only receives the lines. */
export function readCampaignFile(
  file: File,
  segmentColumn: string,
): Promise<TableFileRead> {
  return readTableFile(file, {
    isHeader: (columns) => isCampaignHeader(columns, segmentColumn),
    maxLines: MAX_CAMPAIGN_FILE_LINES,
    missingHeader: "El archivo no tiene las columnas de RUC y segmento.",
  });
}
