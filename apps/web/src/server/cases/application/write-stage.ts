import type { Role } from "~/domain/auth/access/rbac";
import { fail, type DomainError } from "~/domain/errors";
import type { CaseId, UserId } from "~/domain/ids";
import { appCalendarDateAt } from "~/domain/time/app-time";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";

import { decideStageWrite, type CaseProgress } from "../domain/decide";
import type { CasesRepo } from "../infrastructure/cases-repo";

export type WriteStageCommand = {
  actorUserId: UserId;
  actorRole: Role;
  caseId: CaseId;
  // The version the actor saw, so a write never lands on a case it has not read.
  expectedVersion: number;
  stageKey: string;
  values: Readonly<Record<string, unknown>>;
  status?: string;
};

export type WrittenStage = {
  version: number;
  progress: CaseProgress;
};

export async function writeStage(
  command: WriteStageCommand,
  uow: AppUow<CasesRepo>,
  operation: OperationContext,
): Promise<Result<WrittenStage, DomainError>> {
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
    const written = decideStageWrite(caseType.definition, stored.progress, {
      stageKey: command.stageKey,
      actorRole: command.actorRole,
      actorOwnsCase: stored.ownerUserId === command.actorUserId,
      values: command.values,
      status: command.status,
      today: appCalendarDateAt(operation.operationAt),
    });
    if (!written.ok) {
      return written;
    }
    const status = written.value.statuses[command.stageKey];
    if (status === undefined) {
      throw new Error(`stage ${command.stageKey} has no status after a write`);
    }
    const updated = await cases.updateCase({
      id: stored.id,
      expectedVersion: stored.version,
      values: written.value.values,
      stageKey: command.stageKey,
      status,
      actorUserId: command.actorUserId,
      at: operation.operationAt,
    });
    if (!updated) {
      return Err(fail("case_conflict"));
    }
    return Ok({ version: stored.version + 1, progress: written.value });
  });
}
