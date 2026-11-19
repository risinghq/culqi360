import type { Kysely } from "kysely";

import type { WorkspaceDatabase } from "~/server/platform/database/types";
import { createExecutorUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { createLogger } from "~/shared/observability/runtime-logger";

import { timeOutDueStages } from "./application/time-out-stages";
import { createCasesRepo } from "./infrastructure/cases-repo";

const logger = createLogger("case-timeout-maintenance");

// The cadence bounds how late a stage moves after its deadline. A write that
// lands first wins: the timeout re-checks the stage inside its transaction.
export function createCaseTimeoutMaintenance(deps: {
  executor: Kysely<WorkspaceDatabase>;
}) {
  const uow = createExecutorUow(deps.executor, createCasesRepo);
  return {
    sweepTimeouts: async (context: OperationContext) => {
      try {
        const moved = await timeOutDueStages(
          { executor: deps.executor, uow },
          context.operationAt,
        );
        if (moved > 0) {
          logger.info("case_stages_timed_out", { count: moved });
        }
      } catch (error: unknown) {
        logger.error("case_timeout_sweep_failed", {
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  };
}
