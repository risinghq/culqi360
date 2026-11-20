import type { RecordImportType } from "~/contracts/records/imports";
import type { UserId } from "~/domain/ids";
import type { OperationContext } from "~/server/platform/operation/context";
import type { TableBody } from "~/shared/table";

import { applyRecordImport, type RecordImportPorts } from "./apply";
import { mapRecordImportTable } from "./intake";

export function createRecordImportsRuntime(ports: RecordImportPorts) {
  return {
    /** Maps and applies one batch of lines the browser read. */
    importTable(
      input: {
        actorId: UserId;
        importType: RecordImportType;
        table: TableBody;
      },
      operation: OperationContext,
    ) {
      const { validRows, invalidRows } = mapRecordImportTable(
        input.importType,
        input.table,
      );
      return applyRecordImport(
        { actorId: input.actorId, validRows, invalidCount: invalidRows.length },
        ports,
        operation,
      );
    },
  };
}
