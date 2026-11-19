import { hydrateRuc, type Ruc } from "~/domain/identity/document";
import type { IntegrationJobId, UserId } from "~/domain/ids";
import { enqueueNotifications } from "~/server/notifications/intent/enqueue";
import type { OrganizationEnrichmentQueue } from "~/server/organization/enrichment";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { OperationContext } from "~/server/platform/operation/context";
import type { WorkflowActor } from "~/server/workflow/actor";
import { deriveInquiryAnsweredIntents } from "~/server/workflow/inquiry/notifications";
import type { InquiryRow } from "~/server/workflow/inquiry/repo";
import { loadWorkflowActor } from "~/server/workflow/load-actor";

import { applyLeadMutation } from "./lead-mutation-writer";
import { stageImportRows } from "./staging-repo";
import type { ImportRowInput, RowResult } from "./types";

interface ImportApplyPorts {
  executor: WorkspaceExecutor;
  enrichment: OrganizationEnrichmentQueue;
}

function resultSort(a: RowResult, b: RowResult): number {
  return a.row - b.row;
}

async function loadImportActor(
  executor: WorkspaceExecutor,
  actorId: UserId,
): Promise<WorkflowActor> {
  const actor = await loadWorkflowActor(executor, actorId);
  if (!actor) {
    throw new Error("import_actor_not_found");
  }
  return actor;
}

export async function applyImportRows(
  input: {
    jobId: IntegrationJobId;
    actorId: UserId;
    validRows: ImportRowInput[];
    invalidRows: Array<{
      row: number;
      reason: string;
      type: "import_status" | "import_prioridad";
    }>;
    onProgress?: (progress: {
      rowsTotal: number;
      rowsApplied: number;
      rowsFailed: number;
    }) => void;
    progressEveryRows?: number;
  },
  ports: ImportApplyPorts,
  operation: OperationContext,
): Promise<{
  results: RowResult[];
  applied: number;
  failed: number;
}> {
  const rowsTotal = input.validRows.length + input.invalidRows.length;
  const { executor } = ports;
  const { operationAt } = operation;
  const results: RowResult[] = input.invalidRows.map((row) => ({
    row: row.row,
    ok: false,
    reason: row.reason,
  }));
  const sortedRows = input.validRows.toSorted((a, b) => a.row - b.row);
  let applied = 0;
  let failed = input.invalidRows.length;
  const registeredRucs = new Set<Ruc>();
  const answeredInquiries: InquiryRow[] = [];
  const progressEveryRows = Math.max(1, input.progressEveryRows ?? 50);
  let lastEmittedProcessed = -1;

  function emitProgress(force: boolean): void {
    if (!input.onProgress) {
      return;
    }

    const processed = applied + failed;
    if (
      !force &&
      processed - lastEmittedProcessed < progressEveryRows &&
      processed < rowsTotal
    ) {
      return;
    }

    lastEmittedProcessed = processed;
    input.onProgress({
      rowsTotal,
      rowsApplied: applied,
      rowsFailed: failed,
    });
  }

  emitProgress(true);

  await executor.transaction().execute(async (trx) => {
    const actor = await loadImportActor(trx, input.actorId);

    await stageImportRows(
      trx,
      input.jobId,
      sortedRows,
      input.invalidRows,
      operationAt,
    );

    // File order matters: later rows must see earlier mutations so the outbox
    // plan matches the committed import sequence.
    /* eslint-disable no-await-in-loop */
    for (const row of sortedRows) {
      const mutationResult = await applyLeadMutation({
        executor: trx,
        jobId: input.jobId,
        actor,
        row,
        operationAt,
      });
      results.push(mutationResult.rowResult);
      answeredInquiries.push(...mutationResult.newlyAnsweredInquiries);
      if (!mutationResult.ok) {
        failed++;
        emitProgress(false);
        continue;
      }

      for (const { event } of mutationResult.committed) {
        if (event.eventType === "lead_registered") {
          registeredRucs.add(hydrateRuc(event.payload.ruc));
        }
      }
      applied++;
      emitProgress(false);
    }
    /* eslint-enable no-await-in-loop */

    // Same transaction as the stamps: an executive is never notified about
    // an answer that rolled back.
    await enqueueNotifications(
      trx,
      deriveInquiryAnsweredIntents(answeredInquiries),
      operationAt,
    );
  });
  // The registry is another store, so its requests follow the commit. A crash
  // between the two loses them; "Actualizar SUNAT" recovers a lead.
  await ports.enrichment.requestRucs(
    [...registeredRucs],
    input.actorId,
    operation,
  );
  emitProgress(true);

  const sortedResults = results.toSorted(resultSort);
  return {
    results: sortedResults,
    applied,
    failed: sortedResults.filter((row) => !row.ok).length,
  };
}
