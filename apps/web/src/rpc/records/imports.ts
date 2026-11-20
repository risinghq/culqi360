import {
  MAX_RECORD_IMPORT_ROWS,
  recordImportType,
  type RecordImportType,
} from "~/contracts/records/imports";
import { invalid, type DomainError } from "~/domain/errors";
import { getApplication } from "~/server/composition/application";
import { executeSessionServerFunction } from "~/server/platform/action";
import { mapRecordImportTable } from "~/server/records/imports/intake";
import { Err, Ok, type Result } from "~/shared/result";
import { readTableBody, type TableBody } from "~/shared/table";

type RecordImportTable = {
  importType: RecordImportType;
  table: TableBody;
};

// The browser picks the header, but the server decides the import type from
// the columns it receives.
function parseRecordImportTable(
  input: unknown,
): Result<RecordImportTable, DomainError> {
  const table = readTableBody(input, MAX_RECORD_IMPORT_ROWS);
  const importType = table === null ? null : recordImportType(table.columns);
  if (table === null || importType === null) {
    return Err(invalid({ code: "invalid_import_file" }));
  }
  return Ok({ importType, table });
}

/** Starts a records import from the lines of a file the browser read. */
export async function importRecordTable(input: unknown): Promise<{
  jobId: string;
  importType: RecordImportType;
  rowsTotal: number;
}> {
  "use server";

  return executeSessionServerFunction({
    name: "records.import.upload",
    access: { kind: "permission", permission: "integration:manage" },

    parse: () => parseRecordImportTable(input),

    telemetry: ({ importType, table }) => ({
      importType,
      lines: table.lines.length,
    }),

    execute: async (ctx, { importType, table }) => {
      const { validRows, invalidRows } = mapRecordImportTable(
        importType,
        table,
      );
      const rowsTotal = validRows.length + invalidRows.length;

      const payload = new TextEncoder().encode(
        JSON.stringify({ validRows, invalidRows }),
      );

      const job = await getApplication().integration.records.create({
        type: importType,
        requestedByUserId: ctx.actor.userId,
        rowsTotal,
        payload,
        createdAt: ctx.operationAt,
      });

      return Ok({
        jobId: job.id,
        importType,
        rowsTotal,
      });
    },
  });
}
