import type { OutcomeView } from "~/contracts/activities/views";
import { fail, type DomainError } from "~/domain/errors";
import type { ActivityOutcomeId } from "~/domain/ids";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";

import type { OutcomeSeed } from "../domain/outcome-seed";
import type { OutcomesRepo } from "../infrastructure/outcomes-repo";

export type OutcomesTx = { outcomes: OutcomesRepo };

export type UpdateOutcomeCommand = Omit<OutcomeSeed, "channel"> & {
  id: ActivityOutcomeId;
};

type OutcomeRow = Awaited<ReturnType<OutcomesRepo["listLive"]>>[number];

export function toOutcomeView(row: OutcomeRow): OutcomeView {
  return {
    id: row.id,
    label: row.label,
    channel: row.channel,
    contacted: row.contacted,
    negotiated: row.negotiated,
    callback: row.callback,
  };
}

// A new outcome goes to the end of its channel's list.
export function createOutcome(
  command: OutcomeSeed,
  uow: AppUow<OutcomesTx>,
  operation: OperationContext,
): Promise<Result<ActivityOutcomeId, DomainError>> {
  return uow.run(async ({ outcomes }) => {
    if (await outcomes.findLiveByLabel(command.channel, command.label)) {
      return Err(fail("activity_outcome_exists"));
    }
    const position = await outcomes.nextPosition(command.channel);
    return Ok(
      await outcomes.create({
        ...command,
        position,
        createdAt: operation.operationAt,
      }),
    );
  });
}

export function updateOutcome(
  command: UpdateOutcomeCommand,
  uow: AppUow<OutcomesTx>,
): Promise<Result<void, DomainError>> {
  return uow.run(async ({ outcomes }) => {
    const current = await outcomes.findLive(command.id);
    if (!current) {
      return Err(fail("activity_outcome_not_found"));
    }
    const clash = await outcomes.findLiveByLabel(
      current.channel,
      command.label,
    );
    if (clash && clash.id !== command.id) {
      return Err(fail("activity_outcome_exists"));
    }
    await outcomes.update(command.id, command);
    return Ok(undefined);
  });
}

// Archiving keeps the outcome on the activities that already hold it.
export function archiveOutcome(
  id: ActivityOutcomeId,
  uow: AppUow<OutcomesTx>,
  operation: OperationContext,
): Promise<Result<void, DomainError>> {
  return uow.run(async ({ outcomes }) =>
    (await outcomes.archive(id, operation.operationAt))
      ? Ok(undefined)
      : Err(fail("activity_outcome_not_found")),
  );
}
