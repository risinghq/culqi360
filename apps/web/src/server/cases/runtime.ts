import type { Kysely } from "kysely";

import type { Database } from "~/server/platform/database/types";
import { createExecutorUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";

import { defineCaseType } from "./application/define-case-type";
import { openCase, type OpenCaseCommand } from "./application/open-case";
import { writeStage, type WriteStageCommand } from "./application/write-stage";
import type { CaseTypeDefinition } from "./domain/definition";
import { createCasesRepo } from "./infrastructure/cases-repo";

export function createCasesRuntime(deps: { executor: Kysely<Database> }) {
  const uow = createExecutorUow(deps.executor, createCasesRepo);

  return {
    defineCaseType: (
      definition: CaseTypeDefinition,
      operation: OperationContext,
    ) => defineCaseType(definition, uow, operation),
    open: (command: OpenCaseCommand, operation: OperationContext) =>
      openCase(command, uow, operation),
    writeStage: (command: WriteStageCommand, operation: OperationContext) =>
      writeStage(command, uow, operation),
  };
}

export type CasesRuntime = ReturnType<typeof createCasesRuntime>;
