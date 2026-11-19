import type { Kysely } from "kysely";

import type { ActivityOutcomeId } from "~/domain/ids";
import type { WorkspaceDatabase } from "~/server/platform/database/types";
import { createExecutorUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";

import {
  archiveOutcome,
  createOutcome,
  toOutcomeView,
  updateOutcome,
  type UpdateOutcomeCommand,
} from "./application/outcomes-admin";
import type { OutcomeSeed } from "./domain/outcome-seed";
import { createOutcomesRepo } from "./infrastructure/outcomes-repo";

export function createActivitiesRuntime(deps: {
  executor: Kysely<WorkspaceDatabase>;
}) {
  const outcomes = createOutcomesRepo(deps.executor);
  const uow = createExecutorUow(deps.executor, (tx) => ({
    outcomes: createOutcomesRepo(tx),
  }));

  return {
    listOutcomes: async () => (await outcomes.listLive()).map(toOutcomeView),
    createOutcome: (command: OutcomeSeed, operation: OperationContext) =>
      createOutcome(command, uow, operation),
    updateOutcome: (command: UpdateOutcomeCommand) =>
      updateOutcome(command, uow),
    archiveOutcome: (id: ActivityOutcomeId, operation: OperationContext) =>
      archiveOutcome(id, uow, operation),
  };
}

export type ActivitiesRuntime = ReturnType<typeof createActivitiesRuntime>;
