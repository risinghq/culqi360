import { createCasesRuntime } from "~/server/cases/runtime";
import { createFilesRuntime } from "~/server/files/runtime";

import type { TestDbContext } from "./db";

export function createTestCasesRuntime(ctx: TestDbContext) {
  const files = createFilesRuntime(
    { db: ctx.db, logger: { info() {}, error() {} } },
    { storageRoot: ctx.storageRoot },
  );
  return createCasesRuntime({ executor: ctx.db, files });
}
