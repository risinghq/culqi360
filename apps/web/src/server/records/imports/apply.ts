import type { UserId } from "~/domain/ids";
import { enqueueNotifications } from "~/server/notifications/intent/enqueue";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { OperationContext } from "~/server/platform/operation/context";
import { deriveInquiryAnsweredIntents } from "~/server/workflow/inquiry/notifications";
import { createInquiryRepo } from "~/server/workflow/inquiry/repo";
import { commitLeadChanges } from "~/server/workflow/lead/write/commit";
import { createLeadRepo } from "~/server/workflow/lead/write/lead-repo";
import { loadWorkflowActor } from "~/server/workflow/load-actor";

import { planRecordImport } from "./plan";
import type { ImportRowInput } from "./types";

export interface RecordImportPorts {
  executor: WorkspaceExecutor;
}

export interface RecordImportCounts {
  applied: number;
  failed: number;
}

/** Applies one batch of mapped rows in one transaction: it reads the leads
 * and live inquiries of the batch's RUCs, folds the rows over them, and
 * writes each table once. */
export async function applyRecordImport(
  input: {
    actorId: UserId;
    validRows: readonly ImportRowInput[];
    invalidCount: number;
  },
  ports: RecordImportPorts,
  operation: OperationContext,
): Promise<RecordImportCounts> {
  const { operationAt } = operation;
  const rows = input.validRows.toSorted((a, b) => a.row - b.row);
  const rucs = [...new Set(rows.map((row) => row.ruc))];

  const applied = await ports.executor.transaction().execute(async (trx) => {
    const actor = await loadWorkflowActor(trx, input.actorId);
    if (!actor) {
      throw new Error("import_actor_not_found");
    }
    const inquiries = createInquiryRepo(trx);
    const plan = planRecordImport({
      rows,
      actor,
      operationAt,
      leads: await createLeadRepo(trx).findActiveByRucs(rucs),
      inquiries: await inquiries.listLiveByRucs(rucs),
    });

    await inquiries.saveAnswers(plan.answered, operationAt);
    // The transaction holds the Durable Object from read to write, so a lead
    // cannot move under it; a conflict here is a fault, not a busy lead.
    const committed = await commitLeadChanges(trx, plan.leads, plan.events);
    if (!committed.ok) {
      throw new Error(`import_lead_commit_failed: ${committed.error.code}`);
    }
    // Same transaction as the answers: an executive is never notified about
    // an answer that rolled back.
    await enqueueNotifications(
      trx,
      deriveInquiryAnsweredIntents(plan.newlyAnswered),
      operationAt,
    );
    return plan.applied;
  });

  return { applied, failed: input.invalidCount + rows.length - applied };
}
