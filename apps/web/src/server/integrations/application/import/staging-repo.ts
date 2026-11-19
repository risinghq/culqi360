import type { Transaction } from "kysely";

import { type IntegrationJobId, newRowId } from "~/domain/ids";
import { insertBatches } from "~/server/platform/database/batches";
import type { WorkspaceDatabase } from "~/server/platform/database/types";

import type { ImportRowInput } from "./types";

export async function stageImportRows(
  trx: Transaction<WorkspaceDatabase>,
  jobId: IntegrationJobId,
  validRows: ImportRowInput[],
  invalidRows: Array<{
    row: number;
    reason: string;
    type: "import_status" | "import_prioridad";
  }>,
  stagedAt: Date,
) {
  if (validRows.length > 0) {
    for (const batch of insertBatches(
      validRows.map((row) => ({
        id: newRowId(),
        integration_job_id: jobId,
        row_number: row.row,
        type: row.type,
        ruc: row.ruc,
        status_value: row.type === "import_status" ? row.status : null,
        prioridad_value: row.type === "import_prioridad" ? row.priority : null,
        state: "staged" as const,
        lead_id: null,
        failure_reason: null,
        created_at: stagedAt,
        applied_at: null,
      })),
    )) {
      // eslint-disable-next-line no-await-in-loop
      await trx
        .insertInto("workflow_integration_import_rows")
        .values(batch)
        .execute();
    }
  }

  if (invalidRows.length > 0) {
    for (const batch of insertBatches(
      invalidRows.map((row) => ({
        id: newRowId(),
        integration_job_id: jobId,
        row_number: row.row,
        type: row.type,
        ruc: "",
        status_value: null,
        prioridad_value: null,
        state: "failed" as const,
        lead_id: null,
        failure_reason: row.reason,
        created_at: stagedAt,
        applied_at: null,
      })),
    )) {
      // eslint-disable-next-line no-await-in-loop
      await trx
        .insertInto("workflow_integration_import_rows")
        .values(batch)
        .execute();
    }
  }
}
