import * as XLSX from "xlsx";

import { appWallClockAt } from "~/domain/time/app-time";
import {
  calendarDateParts,
  type CalendarDate,
} from "~/domain/time/calendar-date";

export type TableCell = number | string | null | undefined;

export type TableColumn<Row> = {
  header: string;
  width?: number;
  // An Excel number format, such as "dd/mm/yyyy" or "#,##0.00".
  format?: string;
  value: (row: Row) => TableCell;
};

export const DATE_FORMAT = "dd/mm/yyyy";

export const DATE_TIME_FORMAT = "dd/mm/yyyy hh:mm";

// One sheet: a header row, then one row per item, with an autofilter over
// the whole table.
export function buildTableWorkbook<Row>(table: {
  title: string;
  subject?: string;
  sheetName: string;
  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
}): Uint8Array {
  const { columns, rows } = table;
  const worksheet = XLSX.utils.aoa_to_sheet([
    columns.map((column) => column.header),
    ...rows.map((row) => columns.map((column) => column.value(row))),
  ]);
  if (columns.some((column) => column.width !== undefined)) {
    worksheet["!cols"] = columns.map((column) =>
      column.width === undefined ? {} : { wch: column.width },
    );
  }
  worksheet["!autofilter"] = { ref: worksheet["!ref"] ?? "A1:A1" };
  columns.forEach((column, columnIndex) => {
    if (!column.format) {
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
  workbook.Props = { Title: table.title, Subject: table.subject };
  XLSX.utils.book_append_sheet(workbook, worksheet, table.sheetName);
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

const MS_PER_DAY = 86_400_000;

// Excel's serial for 1970-01-01 in the 1900 date system.
const UNIX_EPOCH_SERIAL = 25_569;

// Excel stores a date as a zoneless day count, so these helpers write the
// serial themselves: SheetJS converts a JS Date with the host's zone.
// setUTCFullYear keeps years below 100 as written.
export function excelDate(value: CalendarDate): number {
  const parts = calendarDateParts(value);
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return serialAt(date.getTime());
}

// The instant as the app's wall clock.
export function excelDateTime(instant: Date): number {
  return serialAt(appWallClockAt(instant).getTime());
}

function serialAt(epochMs: number): number {
  return epochMs / MS_PER_DAY + UNIX_EPOCH_SERIAL;
}
