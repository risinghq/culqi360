import type { RecordImportType } from "~/contracts/records/imports";
import type { ImportRowInput } from "~/server/integrations/application/import/types";
import type { TableBody } from "~/shared/table";

import { mapRecordImportRow, type RecordImportInvalidRow } from "./row-mapper";

export type MappedImport = {
  validRows: ImportRowInput[];
  invalidRows: RecordImportInvalidRow[];
};

/** Maps the lines of a records file the browser read. Row numbers are the
 * file's line numbers, so an error points at the line the user sees. */
export function mapRecordImportTable(
  importType: RecordImportType,
  table: TableBody,
): MappedImport {
  const validRows: ImportRowInput[] = [];
  const invalidRows: RecordImportInvalidRow[] = [];

  for (const { line, cells } of table.lines) {
    const result = mapRecordImportRow({
      rowNumber: line,
      importType,
      headers: table.columns,
      cells,
    });

    if (result.ok) {
      validRows.push(result.row);
    } else {
      invalidRows.push(result.row);
    }
  }

  return { validRows, invalidRows };
}
