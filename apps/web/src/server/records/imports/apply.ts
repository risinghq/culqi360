import { hydrateRuc, type Ruc } from "~/domain/identity/document";
import type { UserId } from "~/domain/ids";
import { enqueueNotifications } from "~/server/notifications/intent/enqueue";
import type { OrganizationEnrichmentQueue } from "~/server/organization/enrichment";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { OperationContext } from "~/server/platform/operation/context";
import { deriveInquiryAnsweredIntents } from "~/server/workflow/inquiry/notifications";
import type { InquiryRow } from "~/server/workflow/inquiry/repo";
import { loadWorkflowActor } from "~/server/workflow/load-actor";

import { applyImportRow } from "./apply-row";
import type { ImportRowInput } from "./types";

export interface RecordImportPorts {
  executor: WorkspaceExecutor;
  enrichment: OrganizationEnrichmentQueue;
}

export interface RecordImportCounts {
  applied: number;
  failed: number;
}

/** Applies one batch of mapped rows in one transaction, in file order. */
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
  const registeredRucs = new Set<Ruc>();
  let applied = 0;

  await ports.executor.transaction().execute(async (trx) => {
    const actor = await loadWorkflowActor(trx, input.actorId);
    if (!actor) {
      throw new Error("import_actor_not_found");
    }
    const answeredInquiries: InquiryRow[] = [];

    // Later rows must see earlier mutations so the outbox plan matches the
    // committed import sequence.
    /* eslint-disable no-await-in-loop */
    for (const row of rows) {
      const result = await applyImportRow({
        executor: trx,
        actor,
        row,
        operationAt,
      });
      answeredInquiries.push(...result.newlyAnsweredInquiries);
      if (!result.ok) {
        continue;
      }
      for (const { event } of result.committed) {
        if (event.eventType === "lead_registered") {
          registeredRucs.add(hydrateRuc(event.payload.ruc));
        }
      }
      applied++;
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

  return { applied, failed: input.invalidCount + rows.length - applied };
}
