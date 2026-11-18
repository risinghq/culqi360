import { ACTIVITY_CHANNEL_LABELS } from "~/domain/activities/channel";
import { formatCalendarMonthName } from "~/domain/time/app-time";
import {
  buildTableWorkbook,
  DATE_TIME_FORMAT,
  excelDateTime,
  type TableColumn,
} from "~/server/platform/xlsx/table-workbook";

import type { ProductionReport } from "../application/production-report";
import type { ActivityRow } from "../infrastructure/reports-repo";

type ProductionLine = {
  name: string;
  counts: readonly number[];
  total: number;
  sum: number | null;
};

// One row per holder, a column per status of the stage, then the total and
// the summed field. The last row holds the totals.
export function buildProductionWorkbook(report: ProductionReport): Uint8Array {
  const columns: TableColumn<ProductionLine>[] = [
    { header: "Usuario", width: 28, value: (line) => line.name },
    ...report.statuses.map((status, index): TableColumn<ProductionLine> => ({
      header: status.label,
      width: 14,
      value: (line) => line.counts[index] ?? 0,
    })),
    { header: "Total", width: 10, value: (line) => line.total },
  ];
  if (report.sumLabel !== null) {
    columns.push({
      header: report.sumLabel,
      width: 16,
      format: "#,##0.##",
      value: (line) => line.sum,
    });
  }
  return buildTableWorkbook({
    title: `${report.caseTypeName}: ${report.stageName}`,
    subject: formatCalendarMonthName(report.month),
    sheetName: "Producción",
    columns,
    rows: [
      ...report.rows.map((row) => ({ ...row, name: row.holderName })),
      { ...report.totals, name: "Total" },
    ],
  });
}

const ACTIVITY_COLUMNS: readonly TableColumn<ActivityRow>[] = [
  {
    header: "Fecha",
    width: 17,
    format: DATE_TIME_FORMAT,
    value: (row) => excelDateTime(row.startedAt),
  },
  {
    header: "Canal",
    width: 10,
    value: (row) => ACTIVITY_CHANNEL_LABELS[row.channel],
  },
  { header: "Usuario", width: 24, value: (row) => row.userName },
  { header: "RUC", width: 13, value: (row) => row.ruc },
  { header: "Razón social", width: 36, value: (row) => row.legalName },
  { header: "Contacto", width: 28, value: (row) => row.contactName },
  { header: "Teléfono", width: 14, value: (row) => row.phone },
  { header: "Caso o campaña", width: 24, value: (row) => row.subject },
  { header: "Resultado", width: 24, value: (row) => row.outcomeLabel },
  {
    header: "Duración (s)",
    width: 12,
    value: (row) => row.durationSeconds,
  },
  { header: "Notas", width: 48, value: (row) => row.notes },
];

export function buildActivityWorkbook(
  rows: readonly ActivityRow[],
): Uint8Array {
  return buildTableWorkbook({
    title: "Actividad",
    sheetName: "Actividad",
    columns: ACTIVITY_COLUMNS,
    rows,
  });
}
