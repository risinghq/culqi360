import { fail, type DomainError } from "~/domain/errors";
import type { CampaignId, UserId } from "~/domain/ids";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";

import { CAMPAIGN_BATCH_SIZE } from "../domain/import-rows";
import type { HeldRecord } from "../infrastructure/campaigns-repo";
import type { CampaignsTx } from "./campaigns-tx";

export type DrawBatchCommand = {
  actorUserId: UserId;
  campaignId: CampaignId;
  segment: string | null;
};

// An executive holds one batch at a time. While records in it remain
// unworked, a draw returns that batch, so a second click takes nothing new
// and nobody hoards the pool.
export async function drawBatch(
  command: DrawBatchCommand,
  uow: AppUow<CampaignsTx>,
  operation: OperationContext,
): Promise<Result<HeldRecord[], DomainError>> {
  return uow.run(async ({ campaigns }) => {
    if (!(await campaigns.campaignExists(command.campaignId))) {
      return Err(fail("campaign_not_found"));
    }
    const held = await campaigns.findHeld(
      command.campaignId,
      command.actorUserId,
    );
    if (held.length > 0) {
      return Ok(held);
    }
    await campaigns.draw({
      campaignId: command.campaignId,
      segment: command.segment,
      userId: command.actorUserId,
      limit: CAMPAIGN_BATCH_SIZE,
      at: operation.operationAt,
    });
    return Ok(
      await campaigns.findHeld(command.campaignId, command.actorUserId),
    );
  });
}
