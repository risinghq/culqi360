import { createCasesRuntime } from "~/server/cases/runtime";
import { createFilesRuntime } from "~/server/files/runtime";

import { testWorkspaceInfrastructure } from "./app";
import type { TestDbContext } from "./db";

export function createTestCasesRuntime(ctx: TestDbContext) {
  const files = createFilesRuntime(testWorkspaceInfrastructure(ctx), {
    storageRoot: ctx.storageRoot,
  });
  return createCasesRuntime({ executor: ctx.db, files });
}
