import type { Transaction } from "kysely";

import type { WorkspaceDatabase } from "~/server/platform/database/types";
import type { WorkflowActor } from "~/server/workflow/actor";
import { createInquiryRepo } from "~/server/workflow/inquiry/repo";
import { reviewLead } from "~/server/workflow/lead/domain/decide";
import { commitTransition } from "~/server/workflow/lead/write/commit";
import { pairCommittedEvents } from "~/server/workflow/lead/write/transition";
import { createWorkflowRepos } from "~/server/workflow/repos";

import type { ImportRowInput, LeadMutationResult } from "./types";

const IMPORT_REASON = "Imported from CSV";

const NOT_IN_REVIEW = "Lead is not in pending external review stage";

/** Applies one import row: it answers the RUC's live inquiries and reviews
 * its lead. A row that only answers inquiries still counts as applied. */
export async function applyImportRow(input: {
  executor: Transaction<WorkspaceDatabase>;
  actor: WorkflowActor;
  row: ImportRowInput;
  operationAt: Date;
}): Promise<LeadMutationResult> {
  const { row } = input;
  const repos = createWorkflowRepos(input.executor);

  // Inquiry answers remain valid even if the lead mutation cannot be applied.
  const { stamped, newlyAnswered } = await createInquiryRepo(
    input.executor,
  ).stampAnswer({
    ruc: row.ruc,
    status: row.type === "import_status" ? row.status : undefined,
    priority: row.type === "import_prioridad" ? row.priority : undefined,
    answeredBy: input.actor.userId,
    answeredAt: input.operationAt,
  });

  function withoutLeadMutation(reason: string): LeadMutationResult {
    return stamped > 0
      ? {
          ok: true,
          rowResult: { row: row.row, ok: true },
          committed: [],
          newlyAnsweredInquiries: newlyAnswered,
        }
      : {
          ok: false,
          rowResult: { row: row.row, ok: false, reason },
          newlyAnsweredInquiries: newlyAnswered,
        };
  }

  const lead = await repos.leads.findActiveByRuc(row.ruc);

  if (!lead) {
    return withoutLeadMutation("RUC not found");
  }

  if (lead.stage !== "QUALIFYING") {
    return withoutLeadMutation(NOT_IN_REVIEW);
  }

  const transition = reviewLead(lead, {
    actor: input.actor,
    rowType: row.type === "import_status" ? "status" : "priority",
    status: row.type === "import_status" ? row.status : lead.status,
    priority: row.type === "import_prioridad" ? row.priority : lead.priority,
    reason: IMPORT_REASON,
    occurredAt: input.operationAt,
  });

  if (!transition.ok) {
    return withoutLeadMutation(
      transition.error.code === "invalid_stage"
        ? NOT_IN_REVIEW
        : (transition.error.code ?? "Could not apply row"),
    );
  }

  const committed = await commitTransition(input.executor, transition.value);

  if (!committed.ok) {
    return withoutLeadMutation(
      committed.error.code === "concurrency_conflict"
        ? "Lead changed concurrently"
        : (committed.error.code ?? "Could not apply row"),
    );
  }

  return {
    ok: true,
    rowResult: { row: row.row, ok: true },
    committed: pairCommittedEvents(
      transition.value.events,
      committed.value.eventIds,
    ),
    newlyAnsweredInquiries: newlyAnswered,
  };
}
