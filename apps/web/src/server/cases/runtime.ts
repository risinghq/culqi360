import type { Kysely } from "kysely";

import type { Role } from "~/domain/auth/access/rbac";
import type { FilesRuntime } from "~/server/files/runtime";
import type { FileOperationContext } from "~/server/files/service/contracts";
import type { Database } from "~/server/platform/database/types";
import { createExecutorUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";

import { defineCaseType } from "./application/define-case-type";
import { exportCaseReport } from "./application/export-cases";
import {
  bindOpenCaseTx,
  openCase,
  type OpenCaseCommand,
} from "./application/open-case";
import {
  listCases,
  listCaseTypes,
  listWaitingCases,
  readCase,
} from "./application/read-cases";
import { writeStage, type WriteStageCommand } from "./application/write-stage";
import type { CaseTypeDefinition } from "./domain/definition";
import { createCasesRepo } from "./infrastructure/cases-repo";

export function createCasesRuntime(deps: {
  executor: Kysely<Database>;
  files: Pick<FilesRuntime, "repo" | "storage">;
}) {
  const uow = createExecutorUow(deps.executor, createCasesRepo);
  const openUow = createExecutorUow(deps.executor, bindOpenCaseTx);
  const reads = createCasesRepo(deps.executor);

  return {
    types: (role: Role) => listCaseTypes(reads, role),
    list: (input: Parameters<typeof listCases>[1]) => listCases(reads, input),
    waiting: (input: Parameters<typeof listWaitingCases>[1]) =>
      listWaitingCases(reads, input),
    read: (input: Parameters<typeof readCase>[1]) => readCase(reads, input),
    branches: () => reads.listBranches(),
    report: (
      ctx: FileOperationContext,
      input: Parameters<typeof exportCaseReport>[2],
    ) => exportCaseReport({ reads, files: deps.files }, ctx, input),
    defineCaseType: (
      definition: CaseTypeDefinition,
      operation: OperationContext,
    ) => defineCaseType(definition, uow, operation),
    open: (command: OpenCaseCommand, operation: OperationContext) =>
      openCase(command, openUow, operation),
    writeStage: (command: WriteStageCommand, operation: OperationContext) =>
      writeStage(command, uow, operation),
  };
}

export type CasesRuntime = ReturnType<typeof createCasesRuntime>;
