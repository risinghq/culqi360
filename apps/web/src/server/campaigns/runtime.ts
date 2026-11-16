import type { Kysely } from "kysely";

import type { CampaignId, CampaignRecordId, UserId } from "~/domain/ids";
import type { Database } from "~/server/platform/database/types";
import { createExecutorUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";

import { bindCampaignsTx } from "./application/campaigns-tx";
import { drawBatch, type DrawBatchCommand } from "./application/draw-batch";
import {
  importCampaign,
  importCampaignFile,
  type ImportCampaignCommand,
  type ImportCampaignFileCommand,
} from "./application/import-campaign";
import { markWorked, releaseUnworked } from "./application/work-records";
import { createCampaignsRepo } from "./infrastructure/campaigns-repo";

export function createCampaignsRuntime(deps: { executor: Kysely<Database> }) {
  const uow = createExecutorUow(deps.executor, bindCampaignsTx);

  return {
    import: (command: ImportCampaignCommand, operation: OperationContext) =>
      importCampaign(command, uow, operation),
    importFile: (
      command: ImportCampaignFileCommand,
      operation: OperationContext,
    ) => importCampaignFile(command, uow, operation),
    draw: (command: DrawBatchCommand, operation: OperationContext) =>
      drawBatch(command, uow, operation),
    release: (
      command: { actorUserId: UserId; campaignId: CampaignId },
      operation: OperationContext,
    ) => releaseUnworked(command, uow, operation),
    markWorked: (
      command: { actorUserId: UserId; recordId: CampaignRecordId },
      operation: OperationContext,
    ) => markWorked(command, uow, operation),
    availableBySegment: (campaignId: CampaignId) =>
      createCampaignsRepo(deps.executor).availableBySegment(campaignId),
  };
}

export type CampaignsRuntime = ReturnType<typeof createCampaignsRuntime>;
