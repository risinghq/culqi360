import type { Expression, ExpressionBuilder, SqlBool } from "kysely";

import { QUALITY_ISSUE_COPY } from "~/contracts/merchant-stats/quality-copy";
import type {
  Page,
  QualityRow,
  QualitySummary,
} from "~/contracts/merchant-stats/views";
import type { QualityIssue } from "~/contracts/merchant-stats/vocabulary";
import {
  calendarMonthStart,
  type CalendarMonth,
} from "~/domain/time/calendar-date";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { WorkspaceDatabase } from "~/server/platform/database/types";

import { monthFromStorageDate } from "../storage-month";
import { displayName } from "./names";
import { getLatestGpvMonth } from "./options";
import { targetGpvAsOfMonth } from "./target-as-of";

type SaleContext = ExpressionBuilder<
  WorkspaceDatabase & { s: WorkspaceDatabase["merchant_sales"] },
  "s"
>;

function fulfilledSerials(eb: SaleContext) {
  return eb
    .selectFrom("lead_fulfillment_units as unit")
    .innerJoin("lead_fulfillment_orders as ord", "ord.id", "unit.order_id")
    .innerJoin("workflow_leads as lead", "lead.id", "ord.lead_id")
    .innerJoin("organizations as org", "org.id", "lead.organization_id")
    .select("unit.id")
    .whereRef("org.ruc", "=", "s.ruc");
}

// Only flag a mismatch when the RUC has fulfillment serials to compare against.
function serialMismatched(eb: SaleContext): Expression<SqlBool> {
  return eb.and([
    eb("s.serial_number", "is not", null),
    eb.not(
      eb.exists(
        fulfilledSerials(eb).whereRef(
          "unit.serial_number",
          "=",
          "s.serial_number",
        ),
      ),
    ),
    eb.exists(fulfilledSerials(eb)),
  ]);
}

export async function getQualitySummary(
  db: WorkspaceExecutor,
): Promise<QualitySummary> {
  const month = await getLatestGpvMonth(db);

  if (!month) {
    return {
      no_owner: 0,
      no_target: 0,
      serial_mismatch: 0,
      no_mesa: 0,
    };
  }

  const [noOwner, noTarget, serialMismatch, noMesa] = await Promise.all([
    db
      .selectFrom("merchant_monthly_gpv as m")
      .leftJoin("merchant_month_credit as credit", (join) =>
        join
          .onRef("credit.ruc", "=", "m.ruc")
          .onRef("credit.month", "=", "m.month"),
      )
      .where("m.month", "=", calendarMonthStart(month))
      .where("credit.ruc", "is", null)
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirst(),
    db
      .selectFrom("merchant_monthly_gpv as m")
      .where("m.month", "=", calendarMonthStart(month))
      .where((eb) => eb(targetGpvAsOfMonth(eb), "is", null))
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirst(),
    db
      .selectFrom("merchant_sales as s")
      .where((eb) => serialMismatched(eb))
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirst(),
    db
      .selectFrom("merchant_sales as s")
      .where("s.mesa", "is", null)
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirst(),
  ]);

  return {
    no_owner: noOwner?.count ?? 0,
    no_target: noTarget?.count ?? 0,
    serial_mismatch: serialMismatch?.count ?? 0,
    no_mesa: noMesa?.count ?? 0,
  };
}

export async function getQualityRows(
  db: WorkspaceExecutor,
  issue: QualityIssue,
  page: Page,
): Promise<QualityRow[]> {
  if (issue === "serial_mismatch") {
    return serialMismatchRows(db, page);
  }

  if (issue === "no_mesa") {
    return noMesaRows(db, page);
  }

  const month = await getLatestGpvMonth(db);

  if (!month) {
    return [];
  }

  if (issue === "no_target") {
    return noTargetRows(db, page, month);
  }

  return noOwnerRows(db, page, month);
}

async function noOwnerRows(
  db: WorkspaceExecutor,
  page: Page,
  month: CalendarMonth,
): Promise<QualityRow[]> {
  const rows = await db
    .selectFrom("merchant_monthly_gpv as m")
    .leftJoin("merchant_month_credit as a", (join) =>
      join.onRef("a.ruc", "=", "m.ruc").onRef("a.month", "=", "m.month"),
    )
    .leftJoin("organizations as o", "o.ruc", "m.ruc")
    .where("m.month", "=", calendarMonthStart(month))
    .where("a.ruc", "is", null)
    .select((eb) => [
      "m.ruc",
      "m.month",
      "m.gpv",
      "o.legal_name",
      latestSale(eb).select("ms.trade_name").as("trade_name"),
      latestSale(eb).select("ms.culqi_user_name").as("culqi_user_name"),
    ])
    .orderBy("m.gpv", "desc")
    .limit(page.limit)
    .offset(page.offset)
    .execute();

  return rows.map((row) => ({
    ruc: row.ruc,
    month: monthFromStorageDate(row.month),
    organizationName: row.legal_name,
    tradeName: row.trade_name,
    sellerName: null,
    culqiUserName: row.culqi_user_name,
    gpvAtStake: row.gpv ?? 0,
    method: "none",
    confidence: "none",
    detail: QUALITY_ISSUE_COPY.no_owner.detail,
    evidence: null,
  }));
}

async function noTargetRows(
  db: WorkspaceExecutor,
  page: Page,
  month: CalendarMonth,
): Promise<QualityRow[]> {
  const rows = await db
    .selectFrom("merchant_monthly_gpv as m")
    // Filtered before the joins, while the builder holds only the monthly row.
    .where("m.month", "=", calendarMonthStart(month))
    .where((eb) => eb(targetGpvAsOfMonth(eb), "is", null))
    .leftJoin("merchant_month_credit as a", (join) =>
      join.onRef("a.ruc", "=", "m.ruc").onRef("a.month", "=", "m.month"),
    )
    .leftJoin("organizations as o", "o.ruc", "m.ruc")
    .leftJoin("members as u", "u.user_id", "a.seller_user_id")
    .select([
      "m.ruc",
      "m.month",
      "m.gpv",
      "a.method",
      "a.confidence",
      "a.first_snapshot_id",
      "o.legal_name",
      "u.names",
      "u.first_surname",
    ])
    .select((eb) => [
      latestSale(eb).select("ms.trade_name").as("trade_name"),
      latestSale(eb).select("ms.culqi_user_name").as("culqi_user_name"),
    ])
    .orderBy("m.gpv", "desc")
    .limit(page.limit)
    .offset(page.offset)
    .execute();

  return rows.map((row) => ({
    ruc: row.ruc,
    month: monthFromStorageDate(row.month),
    organizationName: row.legal_name,
    tradeName: row.trade_name,
    sellerName: displayName(row),
    culqiUserName: row.culqi_user_name,
    gpvAtStake: row.gpv ?? 0,
    method: row.method ?? "none",
    confidence: row.confidence ?? "none",
    detail: QUALITY_ISSUE_COPY.no_target.detail,
    evidence:
      row.first_snapshot_id === null
        ? null
        : { firstSnapshotId: row.first_snapshot_id },
  }));
}

async function serialMismatchRows(
  db: WorkspaceExecutor,
  page: Page,
): Promise<QualityRow[]> {
  const rows = await db
    .selectFrom("merchant_sales as s")
    .leftJoin("organizations as o", "o.ruc", "s.ruc")
    .leftJoin("merchant_monthly_gpv as m", (join) =>
      join.onRef("m.ruc", "=", "s.ruc").onRef("m.month", "=", "s.sale_month"),
    )
    .where((eb) => serialMismatched(eb))
    .select([
      "s.ruc",
      "s.sale_month",
      "s.serial_number",
      "s.trade_name",
      "s.culqi_user_name",
      "m.gpv",
      "o.legal_name",
    ])
    .orderBy("m.gpv", "desc")
    .limit(page.limit)
    .offset(page.offset)
    .execute();

  return rows.map((row) => ({
    ruc: row.ruc,
    month: monthFromStorageDate(row.sale_month),
    organizationName: row.legal_name,
    tradeName: row.trade_name,
    sellerName: null,
    culqiUserName: row.culqi_user_name,
    gpvAtStake: row.gpv ?? 0,
    method: "none" as const,
    confidence: "none" as const,
    detail: QUALITY_ISSUE_COPY.serial_mismatch.detail,
    evidence: { culqiSerial: row.serial_number },
  }));
}

async function noMesaRows(
  db: WorkspaceExecutor,
  page: Page,
): Promise<QualityRow[]> {
  const rows = await db
    .selectFrom("merchant_sales as s")
    .leftJoin("organizations as o", "o.ruc", "s.ruc")
    .leftJoin("merchant_monthly_gpv as m", (join) =>
      join.onRef("m.ruc", "=", "s.ruc").onRef("m.month", "=", "s.sale_month"),
    )
    .where("s.mesa", "is", null)
    .select([
      "s.ruc",
      "s.sale_month",
      "s.trade_name",
      "s.culqi_user_name",
      "m.gpv",
      "o.legal_name",
    ])
    .orderBy("m.gpv", "desc")
    .limit(page.limit)
    .offset(page.offset)
    .execute();

  return rows.map((row) => ({
    ruc: row.ruc,
    month: monthFromStorageDate(row.sale_month),
    organizationName: row.legal_name,
    tradeName: row.trade_name,
    sellerName: null,
    culqiUserName: row.culqi_user_name,
    gpvAtStake: row.gpv ?? 0,
    method: "none" as const,
    confidence: "none" as const,
    detail: QUALITY_ISSUE_COPY.no_mesa.detail,
    evidence: null,
  }));
}

// The RUC's most recent sale names the merchant on a monthly row.
function latestSale(
  eb: ExpressionBuilder<
    WorkspaceDatabase & { m: WorkspaceDatabase["merchant_monthly_gpv"] },
    "m"
  >,
) {
  return eb
    .selectFrom("merchant_sales as ms")
    .whereRef("ms.ruc", "=", "m.ruc")
    .orderBy("ms.sold_on", "desc")
    .limit(1);
}
