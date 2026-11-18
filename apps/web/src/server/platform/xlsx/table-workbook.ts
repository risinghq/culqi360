import * as XLSX from "xlsx";

import { appWallClockAt } from "~/domain/time/app-time";
import {
  calendarDateParts,
  type CalendarDate,
} from "~/domain/time/calendar-date";

export type TableCell = Date | number | string | null | undefined;

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
  const worksheet = XLSX.utils.aoa_to_sheet(
    [
      columns.map((column) => column.header),
      ...rows.map((row) => columns.map((column) => column.value(row))),
    ],
    { cellDates: true },
  );
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

// Excel stores a date without a zone, so the cell takes the calendar day at
// UTC midnight. setUTCFullYear keeps years below 100 as written.
export function excelDate(value: CalendarDate): Date {
  const parts = calendarDateParts(value);
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return date;
}

// The instant as the app's wall clock, for the same reason.
export function excelDateTime(instant: Date): Date {
  return appWallClockAt(instant);
}
