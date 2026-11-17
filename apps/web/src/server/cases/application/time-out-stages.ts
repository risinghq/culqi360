import type { Kysely } from "kysely";

import { fail, type DomainError } from "~/domain/errors";
import type { CaseId } from "~/domain/ids";
import type { Database } from "~/server/platform/database/types";
import type { AppUow } from "~/server/platform/database/uow";
import {
  runAsPlatform,
  runInWorkspace,
} from "~/server/platform/database/workspace-scope";
import { Err, Ok, type Result } from "~/shared/result";

import { decideTimeout, nextDeadlines } from "../domain/decide";
import { createCasesRepo, type CasesRepo } from "../infrastructure/cases-repo";

// Moves one stage past its deadline. Idempotent: a stage that a write moved
// or that is not due yet is refused, so a sweep may retry it.
export async function timeOutStage(
  uow: AppUow<CasesRepo>,
  caseId: CaseId,
  stageKey: string,
  at: Date,
): Promise<Result<void, DomainError>> {
  return uow.run(async (cases) => {
    const stored = await cases.findCase(caseId);
    if (!stored) {
      return Err(fail("case_not_found"));
    }
    const caseType = await cases.findCaseTypeById(stored.caseTypeId);
    if (!caseType) {
      throw new Error(`case ${stored.id} has no case type`);
    }
    const definition = caseType.definition;
    const moved = decideTimeout(
      definition,
      stored.progress,
      stageKey,
      stored.deadlines[stageKey] ?? null,
      at,
    );
    if (!moved.ok) {
      return moved;
    }
    const status = moved.value.statuses[stageKey];
    if (status === undefined) {
      throw new Error(`stage ${stageKey} has no status after a timeout`);
    }
    const updated = await cases.updateCase({
      id: stored.id,
      expectedVersion: stored.version,
      values: moved.value.values,
      stageKey,
      status,
      deadlines: nextDeadlines(
        definition,
        stored.progress,
        moved.value,
        stored.deadlines,
        at,
      ),
      actorUserId: null,
      at,
    });
    if (!updated) {
      return Err(fail("case_conflict"));
    }
    await cases.insertEvent({
      caseId: stored.id,
      kind: "timed_out",
      stageKey,
      status,
      actorUserId: null,
      at,
    });
    return Ok(undefined);
  });
}

// Each timeout is its own transaction in its case's workspace, so one stale
// row does not roll back the sweep. Returns how many stages moved.
export async function timeOutDueStages(
  deps: { executor: Kysely<Database>; uow: AppUow<CasesRepo> },
  at: Date,
): Promise<number> {
  const due = await runAsPlatform(() =>
    createCasesRepo(deps.executor).listDueStages(at),
  );
  let moved = 0;
  for (const stage of due) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runInWorkspace(stage.workspaceId, () =>
      timeOutStage(deps.uow, stage.caseId, stage.stageKey, at),
    );
    if (result.ok) {
      moved += 1;
    }
  }
  return moved;
}
