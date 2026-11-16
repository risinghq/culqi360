import type { Role } from "~/domain/auth/access/rbac";
import { fail, type DomainError } from "~/domain/errors";
import type { CaseId, OrganizationId, UserId } from "~/domain/ids";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";

import { decideCaseOpening, type CaseProgress } from "../domain/decide";
import type { CasesRepo } from "../infrastructure/cases-repo";

export type OpenCaseCommand = {
  actorUserId: UserId;
  actorRole: Role;
  caseTypeKey: string;
  organizationId: OrganizationId;
  values: Readonly<Record<string, unknown>>;
};

export type OpenedCase = {
  caseId: CaseId;
  version: number;
  progress: CaseProgress;
};

// The actor files the case in the opening stage and owns it.
export async function openCase(
  command: OpenCaseCommand,
  uow: AppUow<CasesRepo>,
  operation: OperationContext,
): Promise<Result<OpenedCase, DomainError>> {
  return uow.run(async (cases) => {
    const caseType = await cases.findCaseTypeByKey(command.caseTypeKey);
    if (!caseType) {
      return Err(fail("case_type_not_found"));
    }
    if (!(await cases.organizationExists(command.organizationId))) {
      return Err(fail("case_organization_not_found"));
    }
    const opened = decideCaseOpening(caseType.definition, {
      actorRole: command.actorRole,
      values: command.values,
    });
    if (!opened.ok) {
      return opened;
    }
    const caseId = await cases.insertCase({
      caseTypeId: caseType.id,
      organizationId: command.organizationId,
      ownerUserId: command.actorUserId,
      progress: opened.value,
      actorUserId: command.actorUserId,
      at: operation.operationAt,
    });
    return Ok({ caseId, version: 0, progress: opened.value });
  });
}
