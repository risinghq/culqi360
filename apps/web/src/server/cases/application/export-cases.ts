import { fail, type DomainError } from "~/domain/errors";
import type { CaseTypeId, UserId } from "~/domain/ids";
import { appCalendarDateAt } from "~/domain/time/app-time";
import type {
  FileOperationContext,
  StoreFileDeps,
  DownloadTokenDeps,
} from "~/server/files/service/contracts";
import { issueDownloadToken } from "~/server/files/service/issue-download-token";
import { storeGeneratedFile } from "~/server/files/service/store-generated-file";
import { Err, type Result } from "~/shared/result";

import { buildCaseReportWorkbook } from "../export/workbook";
import type { CasesRepo } from "../infrastructure/cases-repo";

export type CaseReportDeps = {
  reads: Pick<
    CasesRepo,
    "findCaseTypeById" | "listCaseReport" | "listBranches"
  >;
  files: StoreFileDeps & DownloadTokenDeps;
};

// The report holds the cases the actor's "Todos" list shows: their own, or
// every case with case:view:all.
export async function exportCaseReport(
  deps: CaseReportDeps,
  ctx: FileOperationContext,
  input: { caseTypeId: CaseTypeId; actorUserId: UserId; viewAll: boolean },
): Promise<Result<{ token: string }, DomainError>> {
  const caseType = await deps.reads.findCaseTypeById(input.caseTypeId);
  if (!caseType || caseType.definition.module !== undefined) {
    return Err(fail("case_type_not_found"));
  }
  const [rows, branches] = await Promise.all([
    deps.reads.listCaseReport({
      caseTypeId: input.caseTypeId,
      holderUserId: input.viewAll ? null : input.actorUserId,
    }),
    deps.reads.listBranches(),
  ]);
  const bytes = buildCaseReportWorkbook(
    caseType.definition,
    rows,
    new Map(branches.map((branch) => [branch.id, branch.name])),
  );
  const stored = await storeGeneratedFile(
    ctx,
    {
      purpose: "case_report",
      filename: `${caseType.definition.key} ${appCalendarDateAt(ctx.operationAt)}.xlsx`,
      bytes,
    },
    deps.files,
  );
  if (!stored.ok) {
    return stored;
  }
  return issueDownloadToken(ctx, stored.value.id, deps.files);
}
