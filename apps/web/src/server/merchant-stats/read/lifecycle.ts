import { sql } from "kysely";

import type {
  BookFilter,
  LifecycleSummary,
} from "~/contracts/merchant-stats/views";
import { DORMANT_AFTER_DAYS } from "~/contracts/merchant-stats/vocabulary";
import { appCalendarDateAt } from "~/domain/time/app-time";
import {
  addCalendarDays,
  calendarMonthStart,
} from "~/domain/time/calendar-date";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { OperationContext } from "~/server/platform/operation/context";

import { creditFilter } from "./filter";

export async function getLifecycle(
  db: WorkspaceExecutor,
  filter: BookFilter,
  operation: OperationContext,
): Promise<LifecycleSummary> {
  const selectedMonth = filter.month ? calendarMonthStart(filter.month) : null;
  const cutoff = addCalendarDays(
    appCalendarDateAt(operation.operationAt),
    -DORMANT_AFTER_DAYS,
  );

  const sales = db
    .selectFrom("merchant_sales as s")
    .innerJoin("merchant_month_credit as a", (join) =>
      join.onRef("a.ruc", "=", "s.ruc").onRef("a.month", "=", "s.sale_month"),
    )
    .where((eb) => creditFilter(eb, filter))
    .$if(selectedMonth !== null, (qb) =>
      qb.where("s.sale_month", "=", selectedMonth ?? ""),
    )
    .$if(filter.product != null, (qb) =>
      qb.where("s.product", "=", filter.product ?? ""),
    );

  const row = await sales
    .select((eb) => [
      eb.fn.countAll<number>().as("sales_total"),
      eb.fn.count<number>("s.activated_on").as("activated_count"),

      // A sale that never transacted is unactivated, not dormant.
      eb.fn
        .count<number>("s.last_transaction_on")
        .filterWhere("s.last_transaction_on", "<", cutoff)
        .as("dormant_count"),
    ])
    .executeTakeFirst();

  const delays = await sales
    .select(
      sql<number>`julianday(s.activated_on) - julianday(s.sold_on)`.as("days"),
    )
    .where("s.activated_on", "is not", null)
    .orderBy("days")
    .execute();

  return {
    salesTotal: row?.sales_total ?? 0,
    activatedCount: row?.activated_count ?? 0,
    medianDaysToActivate: median(delays.map((delay) => delay.days)),
    dormantCount: row?.dormant_count ?? 0,
    dormantThresholdDays: DORMANT_AFTER_DAYS,
  };
}

// Late activations skew a mean; the median better represents a typical
// merchant. The values arrive sorted.
function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  const lower = sorted[middle - 1] ?? upper;
  return Math.round(sorted.length % 2 === 0 ? (lower + upper) / 2 : upper);
}
