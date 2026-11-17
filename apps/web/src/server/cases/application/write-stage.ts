import { fail, type DomainError } from "~/domain/errors";
import type { BranchId, CaseId, UserId } from "~/domain/ids";
import { appCalendarDateAt } from "~/domain/time/app-time";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";

import {
  caseFileIds,
  decideStageWrite,
  nextDeadlines,
  type CaseProgress,
} from "../domain/decide";
import type { CasesRepo } from "../infrastructure/cases-repo";

// The files a write may reference: the actor's own uploads among the submitted
// values, and the files the case already holds. Nobody attaches a file another
// user uploaded, so a file field never opens someone else's upload.
export async function knownFileIds(
  cases: CasesRepo,
  actorUserId: UserId,
  values: Readonly<Record<string, unknown>>,
  held: readonly string[],
): Promise<Set<string>> {
  const submitted = Object.values(values).filter(
    (value): value is string => typeof value === "string",
  );
  const own = await cases.listOwnCaseFileIds(actorUserId, submitted);
  return new Set([...own, ...held]);
}

export type WriteStageCommand = {
  actorUserId: UserId;
  actorRoleKey: string;
  actorBranchId: BranchId;
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
    const definition = caseType.definition;
    const at = operation.operationAt;
    const written = decideStageWrite(definition, stored.progress, {
      stageKey: command.stageKey,
      actor: {
        roleKey: command.actorRoleKey,
        holdsCase: stored.holderUserId === command.actorUserId,
        branchId: command.actorBranchId,
      },
      values: command.values,
      status: command.status,
      today: appCalendarDateAt(at),
      branchIds: await cases.listBranchIds(),
      fileIds: await knownFileIds(
        cases,
        command.actorUserId,
        command.values,
        caseFileIds(definition, stored.progress.values),
      ),
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
      deadlines: nextDeadlines(
        definition,
        stored.progress,
        written.value,
        stored.deadlines,
        at,
      ),
      actorUserId: command.actorUserId,
      at,
    });
    if (!updated) {
      return Err(fail("case_conflict"));
    }
    await cases.insertEvent({
      caseId: stored.id,
      kind: "stage_written",
      stageKey: command.stageKey,
      status,
      actorUserId: command.actorUserId,
      at,
    });
    return Ok({ version: stored.version + 1, progress: written.value });
  });
}
