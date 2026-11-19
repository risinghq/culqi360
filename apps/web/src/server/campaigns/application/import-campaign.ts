import type { DomainError } from "~/domain/errors";
import type { CampaignId } from "~/domain/ids";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { isErr, Ok, type Result } from "~/shared/result";

import {
  checkImportRows,
  type CampaignImportRow,
  type RejectedRow,
} from "../domain/import-rows";
import {
  parseCampaignFile,
  type CampaignFileOptions,
} from "../infrastructure/campaign-file";
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

export type ImportCampaignFileCommand = {
  campaignName: string;
  bytes: Uint8Array;
  options: CampaignFileOptions;
};

export async function importCampaignFile(
  command: ImportCampaignFileCommand,
  uow: AppUow<CampaignsTx>,
  operation: OperationContext,
): Promise<Result<ImportedCampaign, DomainError>> {
  const rows = parseCampaignFile(command.bytes, command.options);
  if (isErr(rows)) {
    return rows;
  }
  return importCampaign(
    { campaignName: command.campaignName, rows: rows.value },
    uow,
    operation,
  );
}
