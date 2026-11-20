import type { SheetCell, SheetFileView } from "~/contracts/sheets/views";
import { appWallClockAt } from "~/domain/time/app-time";
import {
  calendarDateParts,
  type CalendarDate,
} from "~/domain/time/calendar-date";

export type TableColumn<Row> = {
  header: string;
  width?: number;
  // An Excel number format, such as "dd/mm/yyyy" or "#,##0.00".
  format?: string;
  value: (row: Row) => SheetCell | undefined;
};

export const DATE_FORMAT = "dd/mm/yyyy";

export const DATE_TIME_FORMAT = "dd/mm/yyyy hh:mm";

// One sheet: a header row, then one row per item.
export function buildTableSheet<Row>(table: {
  filename: string;
  title: string;
  subject?: string;
  sheetName: string;
  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
}): SheetFileView {
  const { columns } = table;
  return {
    filename: table.filename,
    title: table.title,
    subject: table.subject ?? null,
    sheetName: table.sheetName,
    columns: columns.map((column) => ({
      header: column.header,
      width: column.width ?? null,
      format: column.format ?? null,
    })),
    rows: table.rows.map((row) =>
      columns.map((column) => column.value(row) ?? null),
    ),
  };
}

const MS_PER_DAY = 86_400_000;

// Excel's serial for 1970-01-01 in the 1900 date system.
const UNIX_EPOCH_SERIAL = 25_569;

// Excel stores a date as a zoneless day count. setUTCFullYear keeps years
// below 100 as written.
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
