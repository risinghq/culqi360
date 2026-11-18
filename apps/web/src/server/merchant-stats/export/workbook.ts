import type { CohortSaleRow } from "~/contracts/merchant-stats/views";
import type { CalendarDate, CalendarMonth } from "~/domain/time/calendar-date";
import {
  buildTableWorkbook,
  excelDate as excelCalendarDate,
  type TableColumn,
} from "~/server/platform/xlsx/table-workbook";

const COLUMNS: readonly TableColumn<CohortSaleRow>[] = [
  {
    header: "fecha",
    width: 13,
    format: "dd/mm/yyyy",
    value: (row) => excelDate(row.soldAt),
  },
  { header: "MES", width: 12, value: (row) => saleMonthName(row.saleMonth) },
  {
    header: "añomes_vta",
    width: 12,
    value: (row) => row.saleMonth.replace("-", ""),
  },
  { header: "identificador_tributario", width: 22, value: (row) => row.ruc },
  { header: "ZONAL", width: 20, value: (row) => zonalFromSubchannel(row) },
  { header: "VENDEDOR R", width: 28, value: (row) => row.sellerName },
  {
    header: "PROYECTADO",
    width: 15,
    format: "#,##0.00",
    value: (row) => row.projectedGpv,
  },
  { header: "tipo_cliente", width: 16, value: (row) => row.clientType },
  { header: "id_merchant", width: 19, value: (row) => row.merchantId },
  { header: "num_serie", width: 22, value: (row) => row.serialNumber },
  { header: "producto", width: 16, value: (row) => row.product },
  { header: "nbr_comercial", width: 34, value: (row) => row.tradeName },
  { header: "vendedor", width: 30, value: (row) => row.culqiUserName },
  {
    header: "dia_activo",
    width: 13,
    format: "dd/mm/yyyy",
    value: (row) => excelDate(row.activatedAt),
  },
  {
    header: "ultima_trx",
    width: 13,
    format: "dd/mm/yyyy",
    value: (row) => excelDate(row.lastTransactionAt),
  },
  {
    header: "gpv_m0",
    width: 15,
    format: "#,##0.00",
    value: (row) => pointValue(row, 0, "gpv"),
  },
  {
    header: "trx_m0",
    width: 11,
    format: "0",
    value: (row) => pointValue(row, 0, "trx"),
  },
  {
    header: "gpv_m0_15d",
    width: 15,
    format: "#,##0.00",
    value: (row) => row.m0Plus15d?.gpv,
  },
  {
    header: "trx_m0_15d",
    width: 13,
    format: "0",
    value: (row) => row.m0Plus15d?.trx,
  },
  {
    header: "gpv_m1",
    width: 15,
    format: "#,##0.00",
    value: (row) => pointValue(row, 1, "gpv"),
  },
  {
    header: "trx_m1",
    width: 11,
    format: "0",
    value: (row) => pointValue(row, 1, "trx"),
  },
  {
    header: "gpv_m2",
    width: 15,
    format: "#,##0.00",
    value: (row) => pointValue(row, 2, "gpv"),
  },
  {
    header: "trx_m2",
    width: 11,
    format: "0",
    value: (row) => pointValue(row, 2, "trx"),
  },
];

const MONTH_NAMES = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
] as const;

export function buildMerchantGpvWorkbook(
  rows: readonly CohortSaleRow[],
): Uint8Array {
  return buildTableWorkbook({
    title: "Reporte GPV",
    subject: "Cohortes de ventas",
    sheetName: "BASE",
    columns: COLUMNS,
    rows,
  });
}

function pointValue(
  row: CohortSaleRow,
  offset: number,
  field: "gpv" | "trx",
): number | undefined {
  return row.months.find((point) => point.offset === offset)?.[field];
}

function excelDate(value: CalendarDate | null): Date | null {
  return value ? excelCalendarDate(value) : null;
}

function saleMonthName(saleMonth: CalendarMonth): string {
  const monthIndex = Number(saleMonth.slice(5, 7)) - 1;
  return MONTH_NAMES[monthIndex] ?? "";
}

function zonalFromSubchannel(row: CohortSaleRow): string | null {
  return row.subchannel?.trim().split(/\s+/).at(-1) ?? null;
}
