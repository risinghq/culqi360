import { fail, type DomainError } from "~/domain/errors";
import type { CaseTypeId } from "~/domain/ids";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";

import {
  checkCaseTypeDefinition,
  type CaseTypeDefinition,
} from "../domain/definition";
import type { CasesRepo } from "../infrastructure/cases-repo";

export async function defineCaseType(
  definition: CaseTypeDefinition,
  uow: AppUow<CasesRepo>,
  operation: OperationContext,
): Promise<Result<{ caseTypeId: CaseTypeId }, DomainError>> {
  const checked = checkCaseTypeDefinition(definition);
  if (!checked.ok) {
    return checked;
  }
  return uow.run(async (cases) => {
    if (await cases.findCaseTypeByKey(definition.key)) {
      return Err(fail("case_type_exists"));
    }
    const caseTypeId = await cases.insertCaseType(
      definition,
      operation.operationAt,
    );
    return Ok({ caseTypeId });
  });
}
