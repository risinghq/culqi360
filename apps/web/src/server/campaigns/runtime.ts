import type { Kysely } from "kysely";

import type { CampaignId, UserId } from "~/domain/ids";
import type { WorkspaceDatabase } from "~/server/platform/database/types";
import { createExecutorUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";

import { bindCampaignsTx } from "./application/campaigns-tx";
import { drawBatch, type DrawBatchCommand } from "./application/draw-batch";
import {
  importCampaign,
  importCampaignTable,
  type ImportCampaignCommand,
  type ImportCampaignTableCommand,
} from "./application/import-campaign";
import {
  markWorked,
  releaseUnworked,
  type MarkWorkedCommand,
} from "./application/work-records";
import { createCampaignsRepo } from "./infrastructure/campaigns-repo";

export function createCampaignsRuntime(deps: {
  executor: Kysely<WorkspaceDatabase>;
}) {
  const uow = createExecutorUow(deps.executor, bindCampaignsTx);
  const reads = createCampaignsRepo(deps.executor);

  return {
    list: () => reads.listCampaigns(),
    held: (command: { actorUserId: UserId; campaignId: CampaignId }) =>
      reads.findHeld(command.campaignId, command.actorUserId),
    import: (command: ImportCampaignCommand, operation: OperationContext) =>
      importCampaign(command, uow, operation),
    importTable: (
      command: ImportCampaignTableCommand,
      operation: OperationContext,
    ) => importCampaignTable(command, uow, operation),
    draw: (command: DrawBatchCommand, operation: OperationContext) =>
      drawBatch(command, uow, operation),
    release: (
      command: { actorUserId: UserId; campaignId: CampaignId },
      operation: OperationContext,
    ) => releaseUnworked(command, uow, operation),
    markWorked: (command: MarkWorkedCommand, operation: OperationContext) =>
      markWorked(command, uow, operation),
    availableBySegment: (campaignId: CampaignId) =>
      reads.availableBySegment(campaignId),
  };
}

export type CampaignsRuntime = ReturnType<typeof createCampaignsRuntime>;
