import type { SheetCell, SheetFileView } from "~/contracts/sheets/views";
import type { CaseValue } from "~/domain/cases/field-rules";
import { appCalendarDateAt } from "~/domain/time/app-time";
import { parseCalendarDate } from "~/domain/time/calendar-date";
import {
  buildTableSheet,
  DATE_FORMAT,
  excelDate,
  type TableColumn,
} from "~/server/platform/sheet/table-sheet";

import type {
  CaseFieldDefinition,
  CaseTypeDefinition,
} from "../domain/definition";
import type { CaseReportRow } from "../infrastructure/cases-repo";

type Column = TableColumn<CaseReportRow>;

// One row per case: the company and the filer, then each stage in process
// order with its status, last writer and date, then the fields it writes. A
// field label that two stages share takes its stage's name.
export function buildCaseReportSheet(
  report: {
    definition: CaseTypeDefinition;
    rows: readonly CaseReportRow[];
    branchNames: ReadonlyMap<string, string>;
  },
  at: Date,
): SheetFileView {
  const { definition, rows, branchNames } = report;
  return buildTableSheet({
    filename: `${definition.key} ${appCalendarDateAt(at)}.xlsx`,
    title: definition.name,
    sheetName: "Casos",
    columns: reportColumns(definition, branchNames),
    rows,
  });
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
      format: DATE_FORMAT,
      value: (row) => excelDate(appCalendarDateAt(row.createdAt)),
    },
    {
      header: "Última actualización",
      format: DATE_FORMAT,
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
        format: DATE_FORMAT,
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
        format: field.kind === "date" ? DATE_FORMAT : undefined,
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
): SheetCell {
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
