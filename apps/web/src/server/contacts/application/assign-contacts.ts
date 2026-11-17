import { type DomainError } from "~/domain/errors";
import {
  executeWithUsageReservation,
  type UsageReservationPorts,
} from "~/server/capacity/application/usage/ledger";
import type { EngineClient } from "~/server/integrations/engine/client";
import type { OperationContext } from "~/server/platform/operation/context";
import { isErr, Ok, type Result } from "~/shared/result";

import {
  createContactHoldsFromCandidates,
  type AssignContactsUow,
} from "./contact-hold-writer";
import type { AssignContactsCommand, AssignContactsResult } from "./contracts";
import { planContactHolds, type HoldPlanRepos } from "./hold-plan";

interface AssignContactsDeps {
  repos: HoldPlanRepos;
  uow: AssignContactsUow;
  engine: Pick<EngineClient, "requestCandidates">;
  drawUsageReservationPorts: UsageReservationPorts;
}

export async function assignContacts(
  command: AssignContactsCommand,
  deps: AssignContactsDeps,
  operation: OperationContext,
): Promise<Result<AssignContactsResult, DomainError>> {
  const { repos, uow, engine, drawUsageReservationPorts } = deps;

  const plan = await planContactHolds(command.actorUserId, repos, operation);

  if (isErr(plan)) {
    return plan;
  }

  if (plan.value.requested === 0) {
    return Ok({ requested: 0, assigned: 0 });
  }

  const drawResult = await executeWithUsageReservation(
    {
      kind: "draw",
      actorUserId: command.actorUserId,
      requested: plan.value.requested,
      reserveReason: "draw_refill",
    },
    drawUsageReservationPorts,
    operation,
    async () => {
      const candidates = await engine.requestCandidates({
        branchId: command.branchId,
        userId: command.actorUserId,
        amount: plan.value.requested,
      });

      if (isErr(candidates)) {
        return candidates;
      }

      const assigned = await createContactHoldsFromCandidates({
        actorUserId: command.actorUserId,
        candidates: candidates.value,
        operation,
        uow,
      });

      if (isErr(assigned)) {
        return assigned;
      }

      return Ok({
        value: assigned.value,
        consumed: assigned.value,
      });
    },
  );

  if (isErr(drawResult)) {
    return drawResult;
  }

  return Ok({
    requested: plan.value.requested,
    assigned: drawResult.value,
  });
}
