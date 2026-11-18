import type { DomainError } from "~/domain/errors";
import type {
  DownloadTokenDeps,
  FileOperationContext,
  StoreFileDeps,
} from "~/server/files/service/contracts";
import { issueDownloadToken } from "~/server/files/service/issue-download-token";
import { storeGeneratedFile } from "~/server/files/service/store-generated-file";
import type { Result } from "~/shared/result";

import {
  buildActivityWorkbook,
  buildProductionWorkbook,
} from "../export/workbooks";
import type { ReportsRepo } from "../infrastructure/reports-repo";
import { listReportActivities, type ActivityQuery } from "./activity-report";
import {
  buildProductionReport,
  type ProductionDeps,
  type ProductionQuery,
} from "./production-report";

export type ReportFiles = StoreFileDeps & DownloadTokenDeps;

export async function exportProductionReport(
  deps: ProductionDeps & { files: ReportFiles },
  ctx: FileOperationContext,
  query: ProductionQuery,
): Promise<Result<{ token: string }, DomainError>> {
  const report = await buildProductionReport(deps, query);
  if (!report.ok) {
    return report;
  }
  return storeReport(deps.files, ctx, {
    purpose: "production_report",
    filename: `produccion ${query.month}.xlsx`,
    bytes: buildProductionWorkbook(report.value),
  });
}

export async function exportActivityReport(
  deps: { repo: Pick<ReportsRepo, "listActivities">; files: ReportFiles },
  ctx: FileOperationContext,
  query: ActivityQuery,
): Promise<Result<{ token: string }, DomainError>> {
  const rows = await listReportActivities(deps.repo, query, null);
  if (!rows.ok) {
    return rows;
  }
  return storeReport(deps.files, ctx, {
    purpose: "activity_report",
    filename: `actividad ${query.from} ${query.to}.xlsx`,
    bytes: buildActivityWorkbook(rows.value),
  });
}

async function storeReport(
  files: ReportFiles,
  ctx: FileOperationContext,
  file: {
    purpose: "production_report" | "activity_report";
    filename: string;
    bytes: Uint8Array;
  },
): Promise<Result<{ token: string }, DomainError>> {
  const stored = await storeGeneratedFile(ctx, file, files);
  if (!stored.ok) {
    return stored;
  }
  return issueDownloadToken(ctx, stored.value.id, files);
}
