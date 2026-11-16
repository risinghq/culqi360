import { fail, type DomainError } from "~/domain/errors";
import type { CampaignId, CampaignRecordId, UserId } from "~/domain/ids";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";

import type { CampaignsTx } from "./campaigns-tx";

// Returns the actor's unworked records to the pool. Worked records keep
// their holder.
export async function releaseUnworked(
  command: { actorUserId: UserId; campaignId: CampaignId },
  uow: AppUow<CampaignsTx>,
  operation: OperationContext,
): Promise<Result<{ released: number }, DomainError>> {
  return uow.run(async ({ campaigns }) => {
    if (!(await campaigns.campaignExists(command.campaignId))) {
      return Err(fail("campaign_not_found"));
    }
    const released = await campaigns.releaseUnworked({
      campaignId: command.campaignId,
      userId: command.actorUserId,
      at: operation.operationAt,
    });
    return Ok({ released });
  });
}

export async function markWorked(
  command: { actorUserId: UserId; recordId: CampaignRecordId },
  uow: AppUow<CampaignsTx>,
  operation: OperationContext,
): Promise<Result<void, DomainError>> {
  return uow.run(async ({ campaigns }) => {
    const marked = await campaigns.markWorked({
      recordId: command.recordId,
      userId: command.actorUserId,
      at: operation.operationAt,
    });
    return marked ? Ok(undefined) : Err(fail("campaign_record_not_held"));
  });
}
