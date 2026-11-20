import {
  CAMPAIGN_LEGAL_NAME_COLUMN,
  CAMPAIGN_RUC_COLUMN,
  isCampaignHeader,
} from "~/contracts/campaigns/imports";
import { fail, type DomainError } from "~/domain/errors";
import type { CampaignId } from "~/domain/ids";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";
import { normalizeColumn, type TableBody } from "~/shared/table";

import {
  checkImportRows,
  type CampaignImportRow,
  type RejectedRow,
} from "../domain/import-rows";
import type { CampaignsTx } from "./campaigns-tx";

export type ImportCampaignCommand = {
  campaignName: string;
  rows: readonly CampaignImportRow[];
};

export type ImportedCampaign = {
  campaignId: CampaignId;
  imported: number;
  rejected: RejectedRow[];
};

// Rejected rows are reported, not fatal: a 10k-row file with three bad RUCs
// still loads the rest.
export async function importCampaign(
  command: ImportCampaignCommand,
  uow: AppUow<CampaignsTx>,
  operation: OperationContext,
): Promise<Result<ImportedCampaign, DomainError>> {
  const { records, rejected } = checkImportRows(command.rows);
  return uow.run(async ({ campaigns, organizations }) => {
    const at = operation.operationAt;
    const campaignId = await campaigns.ensureCampaign(command.campaignName, at);
    const ids = await organizations.ensureOrganizations(records, at);
    await campaigns.upsertRecords(
      campaignId,
      records.map((record) => {
        const organizationId = ids.get(record.ruc);
        if (organizationId === undefined) {
          throw new Error("campaign_import_organization_missing");
        }
        return {
          organizationId,
          segment: record.segment,
          facts: record.facts,
        };
      }),
      at,
    );
    return Ok({ campaignId, imported: records.length, rejected });
  });
}

export type ImportCampaignTableCommand = {
  campaignName: string;
  segmentColumn: string;
  table: TableBody;
};

// Every column other than RUC, legal name and segment becomes a fact, keyed
// by its normalized header.
function campaignRows(table: TableBody, segment: string): CampaignImportRow[] {
  return table.lines.map(({ line, cells }) => {
    const values: Record<string, string> = {};
    for (const [index, column] of table.columns.entries()) {
      if (column !== "") {
        values[column] = cells[index] ?? "";
      }
    }
    const {
      [CAMPAIGN_RUC_COLUMN]: ruc,
      [CAMPAIGN_LEGAL_NAME_COLUMN]: legalName,
      [segment]: segmentValue,
      ...facts
    } = values;
    return { line, ruc, legalName, segment: segmentValue, facts };
  });
}

/** Imports one batch of a campaign file the browser read. Batches arrive in
 * file order, so a company listed twice keeps its later line. */
export async function importCampaignTable(
  command: ImportCampaignTableCommand,
  uow: AppUow<CampaignsTx>,
  operation: OperationContext,
): Promise<Result<ImportedCampaign, DomainError>> {
  if (!isCampaignHeader(command.table.columns, command.segmentColumn)) {
    return Err(fail("campaign_file_columns_missing"));
  }
  return importCampaign(
    {
      campaignName: command.campaignName,
      rows: campaignRows(command.table, normalizeColumn(command.segmentColumn)),
    },
    uow,
    operation,
  );
}
