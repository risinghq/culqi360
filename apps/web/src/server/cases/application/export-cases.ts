import type { SheetFileView } from "~/contracts/sheets/views";
import { fail, type DomainError } from "~/domain/errors";
import type { CaseTypeId, UserId } from "~/domain/ids";
import { Err, Ok, type Result } from "~/shared/result";

import { buildCaseReportSheet } from "../export/sheet";
import type { CasesRepo } from "../infrastructure/cases-repo";

export type CaseReportReads = Pick<
  CasesRepo,
  "findCaseTypeById" | "listCaseReport" | "listBranches"
>;

// The report holds the cases the actor's "Todos" list shows: their own, or
// every case with case:view:all.
export async function exportCaseReport(
  reads: CaseReportReads,
  input: {
    caseTypeId: CaseTypeId;
    actorUserId: UserId;
    viewAll: boolean;
    at: Date;
  },
): Promise<Result<SheetFileView, DomainError>> {
  const caseType = await reads.findCaseTypeById(input.caseTypeId);
  if (!caseType) {
    return Err(fail("case_type_not_found"));
  }
  const [rows, branches] = await Promise.all([
    reads.listCaseReport({
      caseTypeId: input.caseTypeId,
      holderUserId: input.viewAll ? null : input.actorUserId,
    }),
    reads.listBranches(),
  ]);
  return Ok(
    buildCaseReportSheet(
      {
        definition: caseType.definition,
        rows,
        branchNames: new Map(
          branches.map((branch) => [branch.id, branch.name]),
        ),
      },
      input.at,
    ),
  );
}
