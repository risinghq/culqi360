import { readTableFile } from "~/browser/files/table";
import { useSnackBar } from "~/components/feedback/snack-bar-manager/use-snack-bar";
import { actionErrorMessage } from "~/contracts/errors";
import {
  MAX_RECORD_IMPORT_ROWS,
  RECORD_IMPORT_BATCH_LINES,
  recordImportType,
  type RecordImportType,
} from "~/contracts/records/imports";
import { importRecordTable } from "~/rpc/records/imports";
import type { TableBody } from "~/shared/table";

const IMPORT_COMPLETED_DURATION_MS = 4_000;

function importTypeUnit(type: RecordImportType, count: number): string {
  if (type === "import_status") {
    return count === 1 ? "estado" : "estados";
  }

  return count === 1 ? "prioridad" : "prioridades";
}

function progressMessage(
  type: RecordImportType,
  processed: number,
  total: number,
): string {
  return `Procesando ${importTypeUnit(type, total)}: ${processed} de ${total}`;
}

export function useRecordsImport() {
  const { enqueueInfoSnackBar, enqueueErrorSnackBar, updateSnackBar } =
    useSnackBar();

  let fileInputRef: HTMLInputElement | undefined;

  // Each batch is its own transaction, so a failed batch leaves the earlier
  // ones applied; importing the file again repeats the same answers.
  async function importBatches(
    importType: RecordImportType,
    table: TableBody,
  ): Promise<void> {
    const { columns, lines } = table;
    const total = lines.length;
    const snackBarId = enqueueInfoSnackBar(
      progressMessage(importType, 0, total),
      { duration: 0 },
    );
    let failed = 0;

    for (let at = 0; at < total; at += RECORD_IMPORT_BATCH_LINES) {
      const batch = lines.slice(at, at + RECORD_IMPORT_BATCH_LINES);
      try {
        // Batches run in file order: a RUC listed twice keeps its later line.
        // eslint-disable-next-line no-await-in-loop
        const result = await importRecordTable({
          table: { columns, lines: batch },
        });
        failed += result.failed;
      } catch (error: unknown) {
        updateSnackBar(snackBarId, {
          message: `Importados ${at} de ${total}. ${actionErrorMessage(error)}`,
          variant: "error",
          duration: IMPORT_COMPLETED_DURATION_MS,
        });
        return;
      }
      updateSnackBar(snackBarId, {
        message: progressMessage(importType, at + batch.length, total),
      });
    }

    const unit = importTypeUnit(importType, total);
    updateSnackBar(snackBarId, {
      message:
        failed > 0
          ? `Procesados ${total} ${unit} (${failed} con error)`
          : `Procesados ${total} ${unit}`,
      variant: failed > 0 ? "warning" : "success",
      duration: IMPORT_COMPLETED_DURATION_MS,
    });
  }

  async function importFile(file: File): Promise<void> {
    const read = await readTableFile(file, {
      isHeader: (columns) => recordImportType(columns) !== null,
      maxLines: MAX_RECORD_IMPORT_ROWS,
      missingHeader: "El archivo no coincide con una plantilla de importación.",
    });
    if (!read.ok) {
      enqueueErrorSnackBar(read.message);
      return;
    }
    const importType = recordImportType(read.table.columns);
    if (importType === null) {
      return;
    }

    await importBatches(importType, read.table);
  }

  function bindFileInput(element: HTMLInputElement): void {
    fileInputRef = element;
  }

  function openFilePicker(): void {
    fileInputRef?.click();
  }

  function onFileInputChange(event: Event): void {
    const target = event.currentTarget;

    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    const file = target.files?.item(0);
    target.value = "";

    if (file) {
      void importFile(file);
    }
  }

  return {
    bindFileInput,
    openFilePicker,
    onFileInputChange,
    importFile,
  };
}
