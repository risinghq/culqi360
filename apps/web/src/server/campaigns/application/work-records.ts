import { fail, type DomainError } from "~/domain/errors";
import type {
  ActivityOutcomeId,
  BranchId,
  CampaignId,
  CampaignRecordId,
  UserId,
} from "~/domain/ids";
import { recordResult } from "~/server/activities/application/record-result";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, isErr, type Result } from "~/shared/result";

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

export type MarkWorkedCommand = {
  actorUserId: UserId;
  branchId: BranchId;
  recordId: CampaignRecordId;
  outcomeId: ActivityOutcomeId;
  notes: string | null;
};

// Closes a held record with its result, in one transaction: the result lands
// on the call or visit logged while the record was held, or becomes one.
export async function markWorked(
  command: MarkWorkedCommand,
  uow: AppUow<CampaignsTx>,
  operation: OperationContext,
): Promise<Result<void, DomainError>> {
  return uow.run(async (repos) => {
    const at = operation.operationAt;
    const held = await repos.campaigns.findHeldOpenRecord({
      recordId: command.recordId,
      userId: command.actorUserId,
    });
    if (!held) {
      return Err(fail("campaign_record_not_held"));
    }
    const recorded = await recordResult(
      {
        actorUserId: command.actorUserId,
        branchId: command.branchId,
        organizationId: held.organization_id,
        subject: {
          kind: "campaign_record",
          campaignRecordId: command.recordId,
        },
        phone: null,
        since: held.held_at,
        at,
        outcomeId: command.outcomeId,
        notes: command.notes,
      },
      repos,
    );
    if (isErr(recorded)) {
      return recorded;
    }
    await repos.campaigns.markWorked({
      recordId: command.recordId,
      userId: command.actorUserId,
      at,
    });
    return Ok(undefined);
  });
}
