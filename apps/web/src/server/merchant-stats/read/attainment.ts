import type {
  Attainment,
  AttainmentCoverage,
  AttainmentRow,
  BookFilter,
} from "~/contracts/merchant-stats/views";
import type { BranchId } from "~/domain/ids";
import {
  calendarMonthStart,
  type CalendarMonth,
} from "~/domain/time/calendar-date";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";

import { creditFilter } from "./filter";
import { displayName } from "./names";
import { targetGpvAsOfMonth } from "./target-as-of";

export async function getAttainment(
  db: WorkspaceExecutor,
  filter: BookFilter,
  month: CalendarMonth,
  viewerBranchId: BranchId,
): Promise<Attainment> {
  const [sellers, branches, gpvCoverage, cohortCoverage] = await Promise.all([
    sellerRows(db, filter, month, viewerBranchId),
    branchRows(db, filter, month),
    monthCoverage(db, month),
    monthCohort(db, month),
  ]);

  return {
    sellers,
    branches,
    coverage: {
      ...gpvCoverage,
      ...cohortCoverage,
    },
  };
}

async function sellerRows(
  db: WorkspaceExecutor,
  filter: BookFilter,
  month: CalendarMonth,
  viewerBranchId: BranchId,
): Promise<AttainmentRow[]> {
  const rows = await db
    .selectFrom("merchant_monthly_gpv as m")
    .innerJoin("merchant_month_credit as a", (join) =>
      join.onRef("a.ruc", "=", "m.ruc").onRef("a.month", "=", "m.month"),
    )
    .leftJoin("members as u", "u.user_id", "a.seller_user_id")
    .leftJoin("branches as b", "b.id", "a.branch_id")
    .where("m.month", "=", calendarMonthStart(month))
    .where((eb) => creditFilter(eb, filter))
    .select((eb) => [
      "a.seller_user_id",
      "u.names",
      "u.first_surname",
      "u.branch_id as member_branch_id",
      "b.name as branch_name",
      eb.fn.sum<number>("m.gpv").as("gpv"),
      eb.fn.sum<number | null>(targetGpvAsOfMonth(eb)).as("monthly_target_gpv"),
      eb.fn.count<number>("m.ruc").distinct().as("ruc_count"),
      eb.fn.sum<number>("m.device_count").as("device_count"),
    ])
    .groupBy([
      "a.seller_user_id",
      "u.names",
      "u.first_surname",
      "u.branch_id",
      "b.name",
    ])
    .execute();

  return rows
    .map((row) => ({
      id: row.seller_user_id,
      memberId:
        row.member_branch_id === viewerBranchId ? row.seller_user_id : null,
      label: displayName(row) ?? "Sin asignar",
      sublabel: row.branch_name,
      gpv: row.gpv ?? 0,
      projectedGpv: row.monthly_target_gpv,
      rucCount: row.ruc_count ?? 0,
      deviceCount: row.device_count ?? 0,
    }))
    .toSorted((a, b) => b.gpv - a.gpv);
}

async function branchRows(
  db: WorkspaceExecutor,
  filter: BookFilter,
  month: CalendarMonth,
): Promise<AttainmentRow[]> {
  const rows = await db
    .selectFrom("merchant_monthly_gpv as m")
    .innerJoin("merchant_month_credit as a", (join) =>
      join.onRef("a.ruc", "=", "m.ruc").onRef("a.month", "=", "m.month"),
    )
    .leftJoin("branches as b", "b.id", "a.branch_id")
    .where("m.month", "=", calendarMonthStart(month))
    .where((eb) => creditFilter(eb, filter))
    .select((eb) => [
      "a.branch_id",
      "b.name as branch_name",
      eb.fn.sum<number>("m.gpv").as("gpv"),
      eb.fn.sum<number | null>(targetGpvAsOfMonth(eb)).as("monthly_target_gpv"),
      eb.fn.count<number>("m.ruc").distinct().as("ruc_count"),
      eb.fn.sum<number>("m.device_count").as("device_count"),
    ])
    .groupBy(["a.branch_id", "b.name"])
    .execute();

  return rows
    .map((row) => ({
      id: row.branch_id,
      memberId: null,
      label: row.branch_name ?? "Sin zonal",
      sublabel: null,
      gpv: row.gpv ?? 0,
      projectedGpv: row.monthly_target_gpv,
      rucCount: row.ruc_count ?? 0,
      deviceCount: row.device_count ?? 0,
    }))
    .toSorted((a, b) => b.gpv - a.gpv);
}

async function monthCoverage(
  db: WorkspaceExecutor,
  month: CalendarMonth,
): Promise<Pick<AttainmentCoverage, "attributedGpv" | "totalGpv">> {
  const row = await db
    .selectFrom("merchant_monthly_gpv as m")
    .where("m.month", "=", calendarMonthStart(month))
    .select((eb) => [
      eb.fn.coalesce(eb.fn.sum<number>("m.gpv"), eb.lit(0)).as("total_gpv"),
      eb.fn
        .coalesce(
          eb.fn.sum<number>(
            eb
              .case()
              // A correlated lookup, not a left join: SQLite cannot flatten
              // the credit view on the right of a left join, so the join
              // would build the whole view first.
              .when(
                eb.exists(
                  eb
                    .selectFrom("merchant_month_credit as a")
                    .select(eb.lit(1).as("one"))
                    .whereRef("a.ruc", "=", "m.ruc")
                    .whereRef("a.month", "=", "m.month")
                    .where("a.seller_user_id", "is not", null),
                ),
              )
              .then(eb.ref("m.gpv"))
              .else(eb.lit(0))
              .end(),
          ),
          eb.lit(0),
        )
        .as("attributed_gpv"),
    ])
    .executeTakeFirstOrThrow();

  return {
    attributedGpv: row.attributed_gpv,
    totalGpv: row.total_gpv,
  };
}

// `month_offset = 0` isolates sales from this month's own cohort.
async function monthCohort(
  db: WorkspaceExecutor,
  month: CalendarMonth,
): Promise<Pick<AttainmentCoverage, "cohortGpv" | "cohortDeviceCount">> {
  const row = await db
    .selectFrom("merchant_sale_gpv as sg")
    .where("sg.sale_month", "=", calendarMonthStart(month))
    .where("sg.month_offset", "=", 0)
    .select((eb) => [
      eb.fn.coalesce(eb.fn.sum<number>("sg.gpv"), eb.lit(0)).as("cohort_gpv"),
      eb.fn.count<number>("sg.sale_id").as("cohort_device_count"),
    ])
    .executeTakeFirstOrThrow();

  return {
    cohortGpv: row.cohort_gpv,
    cohortDeviceCount: row.cohort_device_count,
  };
}
