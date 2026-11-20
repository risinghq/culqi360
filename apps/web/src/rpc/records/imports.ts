import {
  RECORD_IMPORT_BATCH_LINES,
  recordImportType,
  type RecordImportType,
} from "~/contracts/records/imports";
import { invalid, type DomainError } from "~/domain/errors";
import { getApplication } from "~/server/composition/application";
import { executeSessionServerFunction } from "~/server/platform/action";
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
  const table = readTableBody(input, RECORD_IMPORT_BATCH_LINES);
  const importType = table === null ? null : recordImportType(table.columns);
  if (table === null || importType === null) {
    return Err(invalid({ code: "invalid_import_file" }));
  }
  return Ok({ importType, table });
}

/** Applies one batch of a records file. The browser reads the file and sends
 * its lines in batches of `RECORD_IMPORT_BATCH_LINES`. */
export async function importRecordTable(input: unknown): Promise<{
  importType: RecordImportType;
  applied: number;
  failed: number;
}> {
  "use server";

  return executeSessionServerFunction({
    name: "records.import",
    access: { kind: "permission", permission: "integration:manage" },

    parse: () => parseRecordImportTable(input),

    telemetry: ({ importType, table }) => ({
      importType,
      lines: table.lines.length,
    }),

    execute: async (ctx, { importType, table }) => {
      const counts = await getApplication().recordImports.importTable(
        { actorId: ctx.actor.userId, importType, table },
        ctx,
      );
      return Ok({ importType, ...counts });
    },
  });
}
