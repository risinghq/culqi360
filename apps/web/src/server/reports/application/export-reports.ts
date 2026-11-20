import type { SheetFileView } from "~/contracts/sheets/views";
import type { DomainError } from "~/domain/errors";
import { Ok, type Result } from "~/shared/result";

import { buildActivitySheet, buildProductionSheet } from "../export/sheets";
import type { ReportsRepo } from "../infrastructure/reports-repo";
import { listReportActivities, type ActivityQuery } from "./activity-report";
import {
  buildProductionReport,
  type ProductionDeps,
  type ProductionQuery,
} from "./production-report";

export async function exportProductionReport(
  deps: ProductionDeps,
  query: ProductionQuery,
): Promise<Result<SheetFileView, DomainError>> {
  const report = await buildProductionReport(deps, query);
  return report.ok ? Ok(buildProductionSheet(report.value)) : report;
}

// The export holds every activity in the range; the screen shows the first
// ACTIVITY_SCREEN_LIMIT.
export async function exportActivityReport(
  repo: Pick<ReportsRepo, "listActivities">,
  query: ActivityQuery,
): Promise<Result<SheetFileView, DomainError>> {
  const rows = await listReportActivities(repo, query, null);
  return rows.ok ? Ok(buildActivitySheet(query, rows.value)) : rows;
}
