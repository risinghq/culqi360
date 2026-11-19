import type { Transaction } from "kysely";

import { type DomainError } from "~/domain/errors";
import type { WorkspaceDatabase } from "~/server/platform/database/types";
import type { LeadHistoryEventDraft } from "~/server/workflow/lead/domain/history";
import {
  createWorkflowRepos,
  type WorkflowRepos,
} from "~/server/workflow/repos";
import type { WorkflowWriteContext } from "~/server/workflow/types";
import { Err, isErr, type Result } from "~/shared/result";

import {
  appendFacts,
  commitTransition,
  type LeadAssignment,
  type LeadTransition,
} from "./commit";

export type CommittedLeadEvent = { event: LeadHistoryEventDraft; id: string };

export type LeadTransaction = {
  tx: Transaction<WorkspaceDatabase>;
  repos: WorkflowRepos;
  operationAt: Date;
  commitTransition(
    transition: LeadTransition,
    assignment?: LeadAssignment,
  ): Promise<Result<{ eventIds: string[] }, DomainError>>;
  appendFacts(
    events: LeadHistoryEventDraft[],
  ): Promise<Result<{ eventIds: string[] }, DomainError>>;
};

// A domain failure is thrown as a sentinel so the transaction rolls back; the
// runner unwraps it into Err. Any other throw is a fault and propagates.
class LeadTransactionRollback {
  constructor(readonly error: DomainError) {}
}

export function pairCommittedEvents(
  events: LeadHistoryEventDraft[],
  ids: string[],
): CommittedLeadEvent[] {
  return events.map((event, index) => {
    const id = ids[index];
    if (id === undefined) {
      throw new Error(`Lead event ${index} was committed without an id`);
    }

    return { event, id };
  });
}

export function runLeadTransaction<O>(
  scope: WorkflowWriteContext,
  body: (ctx: LeadTransaction) => Promise<Result<O, DomainError>>,
): Promise<Result<O, DomainError>> {
  return scope.executor
    .transaction()
    .execute(async (tx): Promise<Result<O, DomainError>> => {
      const result = await body({
        tx,
        repos: createWorkflowRepos(tx),
        operationAt: scope.operationAt,
        commitTransition: (transition, assignment) =>
          commitTransition(tx, transition, assignment),
        appendFacts: (events) => appendFacts(tx, scope.operationAt, events),
      });

      if (isErr(result)) {
        throw new LeadTransactionRollback(result.error);
      }

      return result;
    })
    .catch((error: unknown) => {
      if (error instanceof LeadTransactionRollback) {
        return Err(error.error);
      }
      throw error;
    });
}
