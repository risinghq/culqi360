import type { Kysely } from "kysely";

import { ACTIVITY_SCREEN_LIMIT } from "~/domain/reports/activity-range";
import type { CasesRuntime } from "~/server/cases/runtime";
import type { FileOperationContext } from "~/server/files/service/contracts";
import type { Database } from "~/server/platform/database/types";

import {
  listReportActivities,
  type ActivityQuery,
} from "./application/activity-report";
import {
  exportActivityReport,
  exportProductionReport,
  type ReportFiles,
} from "./application/export-reports";
import {
  buildProductionReport,
  type ProductionQuery,
} from "./application/production-report";
import {
  createReportsRepo,
  type ReportReach,
} from "./infrastructure/reports-repo";

export function createReportsRuntime(deps: {
  executor: Kysely<Database>;
  files: ReportFiles;
  cases: Pick<CasesRuntime, "definition" | "definitions">;
}) {
  const repo = createReportsRepo(deps.executor);
  const production = { repo, findCaseType: deps.cases.definition };

  return {
    caseTypes: () => deps.cases.definitions(),
    users: (reach: ReportReach) => repo.listUsers(reach),
    outcomes: () => repo.listOutcomes(),
    production: (query: ProductionQuery) =>
      buildProductionReport(production, query),
    activities: (query: ActivityQuery) =>
      listReportActivities(repo, query, ACTIVITY_SCREEN_LIMIT),
    exportProduction: (ctx: FileOperationContext, query: ProductionQuery) =>
      exportProductionReport({ ...production, files: deps.files }, ctx, query),
    exportActivities: (ctx: FileOperationContext, query: ActivityQuery) =>
      exportActivityReport({ repo, files: deps.files }, ctx, query),
  };
}

export type ReportsRuntime = ReturnType<typeof createReportsRuntime>;
