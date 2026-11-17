import { fail, type DomainError } from "~/domain/errors";
import {
  FileAssetId,
  type BranchId,
  type CaseId,
  type CaseTypeId,
  type UserId,
} from "~/domain/ids";
import { Err, Ok, type Result } from "~/shared/result";

import { caseFileIds, stageAccess, type StageAccess } from "../domain/decide";
import {
  openingStage,
  type CaseStageDefinition,
  type CaseTypeDefinition,
} from "../domain/definition";
import type {
  CaseDetail,
  CaseEvent,
  CaseSummary,
  CasesRepo,
  StoredCaseType,
} from "../infrastructure/cases-repo";

export type CaseReads = Pick<
  CasesRepo,
  | "listCaseTypes"
  | "findCaseTypeById"
  | "listCases"
  | "listWaiting"
  | "findCaseDetail"
  | "listEvents"
  | "listFileNames"
  | "listHolderCandidates"
>;

export type CaseTypeOverview = StoredCaseType & {
  // The role files new cases of this type.
  canOpen: boolean;
  // The role owns a stage that cases wait at.
  hasQueue: boolean;
};

export type CaseWithAccess = {
  detail: CaseDetail;
  definition: CaseTypeDefinition;
  access: Record<string, StageAccess>;
  events: CaseEvent[];
  // Display names of the files the case's file fields hold, by file id.
  fileNames: Map<string, string>;
  holderCandidates: { id: UserId; name: string }[];
};

// The stages after the opening one that the role owns. Cases wait there for
// the role once the stage before them lets them through.
function queueStages(
  definition: CaseTypeDefinition,
  roleKey: string,
): CaseStageDefinition[] {
  return definition.stages.filter(
    (stage) => stage.gate !== null && stage.ownerRole === roleKey,
  );
}

export async function listCaseTypes(
  reads: CaseReads,
  roleKey: string,
): Promise<CaseTypeOverview[]> {
  const summaries = await reads.listCaseTypes();
  const stored = await Promise.all(
    summaries.map((summary) => reads.findCaseTypeById(summary.id)),
  );
  return stored
    .filter((caseType): caseType is StoredCaseType => caseType !== null)
    .map((caseType) =>
      Object.assign(caseType, {
        canOpen: caseType.definition.stages.some(
          (stage) => stage.gate === null && stage.ownerRole === roleKey,
        ),
        hasQueue: queueStages(caseType.definition, roleKey).length > 0,
      }),
    );
}

export async function listWaitingCases(
  reads: CaseReads,
  input: { caseTypeId: CaseTypeId; roleKey: string; branchId: BranchId },
): Promise<Result<CaseSummary[], DomainError>> {
  const caseType = await reads.findCaseTypeById(input.caseTypeId);
  if (!caseType) {
    return Err(fail("case_type_not_found"));
  }
  return Ok(
    await reads.listWaiting(
      caseType.id,
      caseType.definition,
      queueStages(caseType.definition, input.roleKey),
      input.branchId,
    ),
  );
}

export async function listCases(
  reads: CaseReads,
  input: { caseTypeId: CaseTypeId; actorUserId: UserId; viewAll: boolean },
): Promise<CaseSummary[]> {
  return reads.listCases({
    caseTypeId: input.caseTypeId,
    holderUserId: input.viewAll ? null : input.actorUserId,
  });
}

// A case is visible to its holder, to a role that sees every case, and to a
// role that owns a stage the case reaches after filing. The users it could be
// handed to are listed only for a viewer who may reassign it.
export async function readCase(
  reads: CaseReads,
  input: {
    caseId: CaseId;
    actorUserId: UserId;
    roleKey: string;
    branchId: BranchId;
    viewAll: boolean;
    canReassign: boolean;
  },
): Promise<Result<CaseWithAccess, DomainError>> {
  const detail = await reads.findCaseDetail(input.caseId);
  if (!detail) {
    return Err(fail("case_not_found"));
  }
  const caseType = await reads.findCaseTypeById(detail.caseTypeId);
  if (!caseType) {
    throw new Error(`case ${detail.id} has no case type`);
  }
  const { definition } = caseType;
  const actor = {
    roleKey: input.roleKey,
    holdsCase: detail.holderUserId === input.actorUserId,
    branchId: input.branchId,
  };
  const visible =
    input.viewAll ||
    actor.holdsCase ||
    queueStages(definition, input.roleKey).length > 0;
  if (!visible) {
    return Err(fail("case_not_found"));
  }
  const progress = { values: detail.values, statuses: detail.statuses };
  const [events, fileNames, holderCandidates] = await Promise.all([
    reads.listEvents(detail.id),
    reads.listFileNames(caseFileIds(definition, detail.values)),
    input.canReassign
      ? reads.listHolderCandidates(openingStage(definition).ownerRole)
      : Promise.resolve([]),
  ]);
  return Ok({
    detail,
    definition,
    access: Object.fromEntries(
      definition.stages.map((stage) => [
        stage.key,
        stageAccess(definition, progress, stage, actor),
      ]),
    ),
    events,
    fileNames,
    holderCandidates,
  });
}

// The file a field of a visible case holds, for a download.
export async function findCaseFile(
  reads: CaseReads,
  input: Parameters<typeof readCase>[1] & { fieldKey: string },
): Promise<Result<FileAssetId, DomainError>> {
  const read = await readCase(reads, input);
  if (!read.ok) {
    return read;
  }
  const field = read.value.definition.fields.find(
    (each) => each.key === input.fieldKey,
  );
  const parsed = FileAssetId.parse(read.value.detail.values[input.fieldKey]);
  if (field?.kind !== "file" || !parsed.ok) {
    return Err(fail("case_file_not_found"));
  }
  return Ok(parsed.value);
}
