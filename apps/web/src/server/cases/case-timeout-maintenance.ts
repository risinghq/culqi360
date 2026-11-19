import type { Kysely } from "kysely";

import type { WorkspaceDatabase } from "~/server/platform/database/types";
import { createExecutorUow } from "~/server/platform/database/uow";
import type { Duty } from "~/server/platform/schedule/schedule";
import { createLogger } from "~/shared/observability/runtime-logger";

import { timeOutDueStages } from "./application/time-out-stages";
import { createCasesRepo } from "./infrastructure/cases-repo";

const logger = createLogger("case-timeout-maintenance");

// A write that lands first wins: the timeout re-checks the stage inside its
// transaction.
export function caseTimeoutDuty(executor: Kysely<WorkspaceDatabase>): Duty {
  const uow = createExecutorUow(executor, createCasesRepo);
  return {
    name: "case-timeout-sweep",
    nextAt: () => createCasesRepo(executor).nextDueAt(),
    async run(context) {
      const moved = await timeOutDueStages(
        { executor, uow },
        context.operationAt,
      );
      if (moved > 0) {
        logger.info("case_stages_timed_out", { count: moved });
      }
    },
  };
}
