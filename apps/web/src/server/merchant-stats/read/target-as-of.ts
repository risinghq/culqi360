import type { ExpressionBuilder } from "kysely";

import type { WorkspaceDatabase } from "~/server/platform/database/types";

// Read each target as of the observed month so later revisions do not change
// history. Each returns a scalar subquery: SQLite has no lateral joins.

type MonthlyContext = ExpressionBuilder<
  WorkspaceDatabase & { m: WorkspaceDatabase["merchant_monthly_gpv"] },
  "m"
>;

type SaleContext = ExpressionBuilder<
  WorkspaceDatabase & { s: WorkspaceDatabase["merchant_sales"] },
  "s"
>;

export function targetGpvAsOfMonth(eb: MonthlyContext) {
  return eb
    .selectFrom("merchant_gpv_targets as mt")
    .innerJoin(
      "organizations as target_org",
      "target_org.id",
      "mt.organization_id",
    )
    .select("mt.monthly_target_gpv")
    .whereRef("target_org.ruc", "=", "m.ruc")
    .whereRef("mt.starts_on", "<=", "m.month")
    .orderBy("mt.starts_on", "desc")
    .limit(1);
}

export function targetGpvAsOfSaleMonth(eb: SaleContext) {
  return eb
    .selectFrom("merchant_gpv_targets as mt")
    .innerJoin(
      "organizations as target_org",
      "target_org.id",
      "mt.organization_id",
    )
    .select("mt.monthly_target_gpv")
    .whereRef("target_org.ruc", "=", "s.ruc")
    .whereRef("mt.starts_on", "<=", "s.sale_month")
    .orderBy("mt.starts_on", "desc")
    .limit(1);
}
