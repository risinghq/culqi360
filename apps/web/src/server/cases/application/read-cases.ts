import { fail, type DomainError } from "~/domain/errors";
import type { BranchId, CaseId, CaseTypeId, UserId } from "~/domain/ids";
import { Err, Ok, type Result } from "~/shared/result";

import { stageAccess, type StageAccess } from "../domain/decide";
import type {
  CaseStageDefinition,
  CaseTypeDefinition,
} from "../domain/definition";
import type {
  CaseDetail,
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
    ownerUserId: input.viewAll ? null : input.actorUserId,
  });
}

// A case is visible to its owner, to a role that sees every case, and to a
// role that owns a stage the case reaches after filing.
export async function readCase(
  reads: CaseReads,
  input: {
    caseId: CaseId;
    actorUserId: UserId;
    roleKey: string;
    branchId: BranchId;
    viewAll: boolean;
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
    ownsCase: detail.ownerUserId === input.actorUserId,
    branchId: input.branchId,
  };
  const visible =
    input.viewAll ||
    actor.ownsCase ||
    queueStages(definition, input.roleKey).length > 0;
  if (!visible) {
    return Err(fail("case_not_found"));
  }
  const progress = { values: detail.values, statuses: detail.statuses };
  return Ok({
    detail,
    definition,
    access: Object.fromEntries(
      definition.stages.map((stage) => [
        stage.key,
        stageAccess(definition, progress, stage, actor),
      ]),
    ),
  });
}
