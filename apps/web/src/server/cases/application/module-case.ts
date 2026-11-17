import type { Json } from "~/contracts/json";
import { fail, type DomainError } from "~/domain/errors";
import type { CaseId, OrganizationId, UserId } from "~/domain/ids";
import { Err, Ok, type Result } from "~/shared/result";

import {
  decideModuleWrite,
  freshProgress,
  type CaseProgress,
  type ModuleWrite,
} from "../domain/decide";
import type { CaseTypeDefinition } from "../domain/definition";
import type {
  CasesRepo,
  NewCaseEvent,
  StoredCase,
} from "../infrastructure/cases-repo";

// What the module did, for its own timeline. The engine stores it unread.
export type ModuleAction = {
  action: string;
  detail?: Json;
  actorUserId: UserId | null;
  subjectUserId?: UserId;
};

// These run inside the module's own transaction, on a repo bound to it, so a
// case write commits with the module's other rows or not at all.

export async function openModuleCase(
  cases: CasesRepo,
  input: {
    caseTypeKey: string;
    organizationId: OrganizationId;
    holderUserId: UserId;
    actorUserId: UserId;
    write: ModuleWrite;
    actions: readonly ModuleAction[];
    at: Date;
  },
): Promise<Result<{ caseId: CaseId; progress: CaseProgress }, DomainError>> {
  const caseType = await cases.findCaseTypeByKey(input.caseTypeKey);
  if (!caseType || caseType.definition.module !== input.write.module) {
    return Err(fail("case_type_not_found"));
  }
  const { definition } = caseType;
  const decided = decideModuleWrite(
    definition,
    freshProgress(definition),
    {},
    input.write,
    input.at,
  );
  if (!decided.ok) {
    return decided;
  }
  const caseId = await cases.insertCase({
    caseTypeId: caseType.id,
    organizationId: input.organizationId,
    holderUserId: input.holderUserId,
    progress: decided.value.progress,
    deadlines: decided.value.deadlines,
    actorUserId: input.actorUserId,
    at: input.at,
  });
  await cases.insertEvents(actionEvents(caseId, input.actions, input.at));
  return Ok({ caseId, progress: decided.value.progress });
}

export async function writeModuleCase(
  cases: CasesRepo,
  input: {
    caseId: CaseId;
    expectedVersion: number;
    write: ModuleWrite;
    actorUserId: UserId | null;
    actions: readonly ModuleAction[];
    at: Date;
  },
): Promise<Result<{ version: number; progress: CaseProgress }, DomainError>> {
  const loaded = await loadModuleCase(cases, input);
  if (!loaded.ok) {
    return loaded;
  }
  const { stored, definition } = loaded.value;
  const decided = decideModuleWrite(
    definition,
    stored.progress,
    stored.deadlines,
    input.write,
    input.at,
  );
  if (!decided.ok) {
    return decided;
  }
  const updated = await cases.updateCase({
    id: stored.id,
    expectedVersion: stored.version,
    values: decided.value.progress.values,
    statuses: input.write.statuses ?? {},
    deadlines: decided.value.deadlines,
    actorUserId: input.actorUserId,
    at: input.at,
  });
  if (!updated) {
    return Err(fail("case_conflict"));
  }
  await cases.insertEvents(actionEvents(stored.id, input.actions, input.at));
  return Ok({ version: stored.version + 1, progress: decided.value.progress });
}

export async function deleteModuleCase(
  cases: CasesRepo,
  input: {
    caseId: CaseId;
    expectedVersion: number;
    module: string;
    actions: readonly ModuleAction[];
    at: Date;
  },
): Promise<Result<null, DomainError>> {
  const loaded = await loadModuleCase(cases, {
    ...input,
    write: { module: input.module },
  });
  if (!loaded.ok) {
    return loaded;
  }
  const deleted = await cases.deleteCase({
    id: input.caseId,
    expectedVersion: input.expectedVersion,
    at: input.at,
  });
  if (!deleted) {
    return Err(fail("case_conflict"));
  }
  await cases.insertEvents(actionEvents(input.caseId, input.actions, input.at));
  return Ok(null);
}

async function loadModuleCase(
  cases: CasesRepo,
  input: { caseId: CaseId; expectedVersion: number; write: ModuleWrite },
): Promise<
  Result<{ stored: StoredCase; definition: CaseTypeDefinition }, DomainError>
> {
  const stored = await cases.findCase(input.caseId);
  if (!stored) {
    return Err(fail("case_not_found"));
  }
  const caseType = await cases.findCaseTypeById(stored.caseTypeId);
  if (!caseType) {
    throw new Error(`case ${stored.id} has no case type`);
  }
  if (caseType.definition.module !== input.write.module) {
    return Err(fail("case_not_found"));
  }
  if (stored.version !== input.expectedVersion) {
    return Err(fail("case_conflict"));
  }
  return Ok({ stored, definition: caseType.definition });
}

function actionEvents(
  caseId: CaseId,
  actions: readonly ModuleAction[],
  at: Date,
): NewCaseEvent[] {
  return actions.map((action) => ({ caseId, kind: "action", ...action, at }));
}
