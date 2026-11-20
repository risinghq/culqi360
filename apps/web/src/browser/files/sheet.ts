import type { CsvFileView, SheetFileView } from "~/contracts/sheets/views";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// xlsx is loaded on the first export, so pages that never export skip it.
export async function sheetWorkbook(
  sheet: SheetFileView,
): Promise<Uint8Array<ArrayBuffer>> {
  const XLSX = await import("xlsx");
  const { columns, rows } = sheet;
  const worksheet = XLSX.utils.aoa_to_sheet([
    columns.map((column) => column.header),
    ...rows,
  ]);
  if (columns.some((column) => column.width !== null)) {
    worksheet["!cols"] = columns.map((column) =>
      column.width === null ? {} : { wch: column.width },
    );
  }
  worksheet["!autofilter"] = { ref: worksheet["!ref"] ?? "A1:A1" };
  columns.forEach((column, columnIndex) => {
    if (column.format === null) {
      return;
    }
    for (let rowIndex = 1; rowIndex <= rows.length; rowIndex += 1) {
      const cell =
        worksheet[XLSX.utils.encode_cell({ c: columnIndex, r: rowIndex })];
      if (cell) {
        cell.z = column.format;
      }
    }
  });

  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: sheet.title,
    Subject: sheet.subject ?? undefined,
  };
  XLSX.utils.book_append_sheet(workbook, worksheet, sheet.sheetName);
  const bytes: ArrayBuffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  });
  return new Uint8Array(bytes);
}

export async function saveSheet(sheet: SheetFileView): Promise<void> {
  const bytes = await sheetWorkbook(sheet);
  saveBlob(sheet.filename, new Blob([bytes], { type: XLSX_MIME }));
}

export function saveCsv(file: CsvFileView): void {
  saveBlob(file.filename, new Blob([file.text], { type: "text/csv" }));
}

function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // The download reads the blob after click() returns; Firefox fails it when
  // the URL is revoked in the same task.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
