import type { Transaction } from "kysely";

import { fail, type DomainError } from "~/domain/errors";
import type { Ruc } from "~/domain/identity/document";
import type { BranchId, CaseId, UserId } from "~/domain/ids";
import { appCalendarDateAt } from "~/domain/time/app-time";
import { createOrganizationRepo } from "~/server/organization/organization-repo";
import type { WorkspaceDatabase } from "~/server/platform/database/types";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";

import {
  decideCaseOpening,
  nextDeadlines,
  type CaseProgress,
} from "../domain/decide";
import { createCasesRepo } from "../infrastructure/cases-repo";
import { knownFileIds } from "./write-stage";

export function bindOpenCaseTx(tx: Transaction<WorkspaceDatabase>) {
  return {
    cases: createCasesRepo(tx),
    organizations: createOrganizationRepo(tx),
  };
}

export type OpenCaseTx = ReturnType<typeof bindOpenCaseTx>;

export type OpenCaseCommand = {
  actorUserId: UserId;
  actorRoleKey: string;
  actorBranchId: BranchId;
  caseTypeKey: string;
  ruc: Ruc;
  values: Readonly<Record<string, unknown>>;
};

export type OpenedCase = {
  caseId: CaseId;
  version: number;
  progress: CaseProgress;
};

// The actor files the case in the opening stage and holds it. The company is
// the workspace's organization for the RUC, created when the workspace has
// none, so a case never references another workspace's row.
export async function openCase(
  command: OpenCaseCommand,
  uow: AppUow<OpenCaseTx>,
  operation: OperationContext,
): Promise<Result<OpenedCase, DomainError>> {
  return uow.run(async ({ cases, organizations }) => {
    const caseType = await cases.findCaseTypeByKey(command.caseTypeKey);
    if (!caseType) {
      return Err(fail("case_type_not_found"));
    }
    const definition = caseType.definition;
    const at = operation.operationAt;
    const opened = decideCaseOpening(definition, {
      actor: { roleKey: command.actorRoleKey, branchId: command.actorBranchId },
      values: command.values,
      today: appCalendarDateAt(at),
      branchIds: await cases.listBranchIds(),
      fileIds: await knownFileIds(
        cases,
        command.actorUserId,
        command.values,
        [],
      ),
    });
    if (!opened.ok) {
      return opened;
    }
    const ids = await organizations.ensureOrganizations(
      [{ ruc: command.ruc, legalName: null }],
      operation.operationAt,
    );
    const organizationId = ids.get(command.ruc);
    if (!organizationId) {
      throw new Error("case_open_organization_missing");
    }
    const caseId = await cases.insertCase({
      caseTypeId: caseType.id,
      organizationId,
      holderUserId: command.actorUserId,
      progress: opened.value,
      deadlines: nextDeadlines(definition, null, opened.value, {}, at),
      actorUserId: command.actorUserId,
      at,
    });
    await cases.insertEvent({
      caseId,
      kind: "opened",
      actorUserId: command.actorUserId,
      holderUserId: command.actorUserId,
      at,
    });
    return Ok({ caseId, version: 0, progress: opened.value });
  });
}
