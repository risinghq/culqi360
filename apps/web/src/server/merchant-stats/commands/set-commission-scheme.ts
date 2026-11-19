import type { Transaction } from "kysely";

import type { DomainError } from "~/domain/errors";
import { CommissionSchemeVersionId, type UserId } from "~/domain/ids";
import {
  validateCommissionSchemeRules,
  type CommissionSchemeRules,
} from "~/domain/merchant-stats/commission";
import type { CalendarDate } from "~/domain/time/calendar-date";
import { createEventsWriter } from "~/server/event-logs/events-repo";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { WorkspaceDatabase } from "~/server/platform/database/types";
import type { OperationContext } from "~/server/platform/operation/context";
import { isErr, Ok, type Result } from "~/shared/result";

export interface SetCommissionSchemeInput {
  effectiveFrom: CalendarDate;
  rules: CommissionSchemeRules;
  setBy: UserId;
  operation: OperationContext;
}

export async function setCommissionScheme(
  db: WorkspaceExecutor,
  input: SetCommissionSchemeInput,
): Promise<Result<void, DomainError>> {
  return db
    .transaction()
    .execute((tx) => setCommissionSchemeInTransaction(tx, input));
}

async function setCommissionSchemeInTransaction(
  tx: Transaction<WorkspaceDatabase>,
  input: SetCommissionSchemeInput,
): Promise<Result<void, DomainError>> {
  const validated = validateCommissionSchemeRules(input.rules);
  if (isErr(validated)) {
    return validated;
  }

  const serializedRules = JSON.stringify(validated.value);

  await tx
    .insertInto("commission_scheme_versions")
    .values({
      id: CommissionSchemeVersionId.mint(),
      starts_on: input.effectiveFrom,
      rules: serializedRules,
      set_by: input.setBy,
      set_at: input.operation.operationAt,
    })
    .onConflict((oc) =>
      oc.columns(["starts_on"]).doUpdateSet({
        rules: serializedRules,
        set_by: input.setBy,
        set_at: input.operation.operationAt,
      }),
    )
    .execute();

  await createEventsWriter(tx).append({
    entityType: "commission_scheme",
    entityId: "default",
    type: "commission_scheme_set",
    actorUserId: input.setBy,
    payload: { effectiveFrom: input.effectiveFrom },
    occurredAt: input.operation.operationAt,
  });

  return Ok(undefined);
}
