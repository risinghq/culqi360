import * as XLSX from "xlsx";

import type { CaseValue } from "~/domain/cases/field-rules";
import { appCalendarDateAt } from "~/domain/time/app-time";
import {
  calendarDateParts,
  parseCalendarDate,
  type CalendarDate,
} from "~/domain/time/calendar-date";

import type {
  CaseFieldDefinition,
  CaseTypeDefinition,
} from "../domain/definition";
import type { CaseReportRow } from "../infrastructure/cases-repo";

type Cell = Date | number | string | null;

type Column = {
  header: string;
  date?: boolean;
  value: (row: CaseReportRow) => Cell;
};

const DATE_FORMAT = "dd/mm/yyyy";

// One row per case: the company and the filer, then each stage in process
// order with its status, last writer and date, then the fields it writes. A
// field label that two stages share takes its stage's name.
export function buildCaseReportWorkbook(
  definition: CaseTypeDefinition,
  rows: readonly CaseReportRow[],
  branchNames: ReadonlyMap<string, string>,
): Uint8Array {
  const columns = reportColumns(definition, branchNames);
  const worksheet = XLSX.utils.aoa_to_sheet(
    [
      columns.map((column) => column.header),
      ...rows.map((row) => columns.map((column) => column.value(row))),
    ],
    { cellDates: true },
  );
  worksheet["!autofilter"] = { ref: worksheet["!ref"] ?? "A1:A1" };
  columns.forEach((column, columnIndex) => {
    if (!column.date) {
      return;
    }
    for (let rowIndex = 1; rowIndex <= rows.length; rowIndex += 1) {
      const cell =
        worksheet[XLSX.utils.encode_cell({ c: columnIndex, r: rowIndex })];
      if (cell) {
        cell.z = DATE_FORMAT;
      }
    }
  });

  const workbook = XLSX.utils.book_new();
  workbook.Props = { Title: definition.name };
  XLSX.utils.book_append_sheet(workbook, worksheet, "Casos");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

function reportColumns(
  definition: CaseTypeDefinition,
  branchNames: ReadonlyMap<string, string>,
): Column[] {
  const labelCounts = new Map<string, number>();
  for (const field of definition.fields) {
    labelCounts.set(field.label, (labelCounts.get(field.label) ?? 0) + 1);
  }
  const columns: Column[] = [
    { header: "RUC", value: (row) => row.ruc },
    { header: "Razón social", value: (row) => row.legalName },
    { header: "Responsable", value: (row) => row.holderName },
    {
      header: "Fecha de registro",
      date: true,
      value: (row) => excelDate(appCalendarDateAt(row.createdAt)),
    },
    {
      header: "Última actualización",
      date: true,
      value: (row) => excelDate(appCalendarDateAt(row.updatedAt)),
    },
  ];
  for (const stage of definition.stages) {
    columns.push(
      {
        header: `${stage.name}: estado`,
        value: (row) => row.stages[stage.key]?.status ?? null,
      },
      {
        header: `${stage.name}: responsable`,
        value: (row) => row.stages[stage.key]?.userName ?? null,
      },
      {
        header: `${stage.name}: fecha`,
        date: true,
        value: (row) => {
          const at = row.stages[stage.key]?.at;
          return at ? excelDate(appCalendarDateAt(at)) : null;
        },
      },
    );
    for (const field of definition.fields) {
      if (field.stageKey !== stage.key) {
        continue;
      }
      columns.push({
        header:
          (labelCounts.get(field.label) ?? 0) > 1
            ? `${field.label} (${stage.name})`
            : field.label,
        date: field.kind === "date",
        value: (row) => fieldCell(field, row.values[field.key], branchNames),
      });
    }
  }
  return columns;
}

function fieldCell(
  field: CaseFieldDefinition,
  value: CaseValue | undefined,
  branchNames: ReadonlyMap<string, string>,
): Cell {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (field.kind === "branch") {
    return branchNames.get(String(value)) ?? String(value);
  }
  if (field.kind === "date") {
    const date = parseCalendarDate(value);
    return date ? excelDate(date) : String(value);
  }
  return value;
}

// Excel stores a date without a zone, so the cell takes the calendar day at
// UTC midnight.
function excelDate(value: CalendarDate): Date {
  const parts = calendarDateParts(value);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}
