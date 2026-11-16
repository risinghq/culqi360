import type { DomainError } from "~/domain/errors";
import type { WorkflowLeadId } from "~/domain/ids";
import type { DatabaseExecutor } from "~/server/platform/database/executor";
import { runInWorkspace } from "~/server/platform/database/workspace-scope";
import { Ok, type Result } from "~/shared/result";

import { expireReservation } from "../../lead/domain/decide";
import { isReservationLapsed } from "../../lead/domain/reservation";
import { createLeadRepo } from "../write/lead-repo";
import { runLeadTransaction } from "../write/transition";

// Idempotent: a lead no longer in PRICING, or whose hold is not actually
// lapsed, is left untouched. Safe for the sweep and the registration guard
// to both call.
export async function expireLeadReservation(
  executor: DatabaseExecutor,
  leadId: WorkflowLeadId,
  expiredAt: Date,
): Promise<Result<void, DomainError>> {
  return runLeadTransaction(
    { executor, operationAt: expiredAt },
    async (ctx) => {
      const state = await ctx.repos.leads.findById(leadId);
      if (!state) {
        return Ok(undefined);
      }
      if (
        state.stage !== "PRICING" ||
        !isReservationLapsed(state, ctx.operationAt)
      ) {
        return Ok(undefined);
      }

      const transition = expireReservation(state, {
        occurredAt: ctx.operationAt,
      });
      if (!transition.ok) {
        return transition;
      }

      const committed = await ctx.commitTransition(transition.value);
      if (!committed.ok) {
        return committed;
      }

      return Ok(undefined);
    },
  );
}

// Each expiry is isolated: one stale row must not roll back the whole sweep.
export async function expireLapsedReservations(
  deps: { executor: DatabaseExecutor },
  lapsedAsOf: Date,
): Promise<number> {
  const lapsed = await createLeadRepo(deps.executor).findLapsedReservations(
    lapsedAsOf,
  );

  let expiredCount = 0;
  for (const lead of lapsed) {
    // The sweep lists lapsed leads across workspaces. Each expiry runs in its
    // lead's workspace so the history event it writes belongs there.
    // eslint-disable-next-line no-await-in-loop
    const result = await runInWorkspace(lead.workspace_id, () =>
      expireLeadReservation(deps.executor, lead.id, lapsedAsOf),
    );
    if (result.ok) {
      expiredCount += 1;
    }
  }
  return expiredCount;
}
