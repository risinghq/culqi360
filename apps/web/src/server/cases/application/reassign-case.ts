import { fail, type DomainError } from "~/domain/errors";
import type { CaseId, UserId } from "~/domain/ids";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";

import { decideReassign } from "../domain/decide";
import type { CasesRepo } from "../infrastructure/cases-repo";

export type ReassignCaseCommand = {
  actorUserId: UserId;
  caseId: CaseId;
  expectedVersion: number;
  holderUserId: UserId;
};

// Hands the case to another user of the role that opens it, for example when
// the holder leaves the team. Who may reassign is the caller's permission check.
export async function reassignCase(
  command: ReassignCaseCommand,
  uow: AppUow<CasesRepo>,
  operation: OperationContext,
): Promise<Result<{ version: number }, DomainError>> {
  return uow.run(async (cases) => {
    const stored = await cases.findCase(command.caseId);
    if (!stored) {
      return Err(fail("case_not_found"));
    }
    if (stored.version !== command.expectedVersion) {
      return Err(fail("case_conflict"));
    }
    const caseType = await cases.findCaseTypeById(stored.caseTypeId);
    if (!caseType) {
      throw new Error(`case ${stored.id} has no case type`);
    }
    const candidate = await cases.findHolderCandidate(command.holderUserId);
    const decided = decideReassign(
      caseType.definition,
      candidate ?? { active: false, roleKey: null },
    );
    if (!decided.ok) {
      return decided;
    }
    const at = operation.operationAt;
    const updated = await cases.updateHolder({
      id: stored.id,
      expectedVersion: stored.version,
      holderUserId: command.holderUserId,
      at,
    });
    if (!updated) {
      return Err(fail("case_conflict"));
    }
    await cases.insertEvent({
      caseId: stored.id,
      kind: "reassigned",
      actorUserId: command.actorUserId,
      holderUserId: command.holderUserId,
      at,
    });
    return Ok({ version: stored.version + 1 });
  });
}
