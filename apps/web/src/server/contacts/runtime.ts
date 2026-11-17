import type { MyContactHoldView } from "~/contracts/contacts/views";
import { epochMilliseconds } from "~/domain/time/clock";
import { createCallsRepo } from "~/server/calls/infrastructure/calls-repo";
import { getDrawCapacitySnapshot } from "~/server/capacity/application/queries/get-draw-capacity-snapshot";
import type { UsageReservationPorts } from "~/server/capacity/application/usage/ledger";
import { createCapacityUsersRepo } from "~/server/capacity/infrastructure/capacity-users-repo";
import {
  createDrawPolicyDefaultsRepo,
  createDrawPolicyOverridesRepo,
} from "~/server/capacity/infrastructure/policy-repos";
import {
  type CapacityCommitsRepo,
  type CapacityGrantsRepo,
  type CapacityReservationsRepo,
  createCapacityCommitsRepo,
  createCapacityGrantsRepo,
  createCapacityReservationsRepo,
} from "~/server/capacity/infrastructure/usage-repo";
import { createContactCadenceRepo } from "~/server/contacts/infrastructure/cadence-repo";
import { createContactHoldsRepo } from "~/server/contacts/infrastructure/hold-repo";
import type { EngineClient } from "~/server/integrations/engine/client";
import { createOrganizationRepo } from "~/server/organization/organization-repo";
import type { DatabaseExecutor } from "~/server/platform/database/executor";
import { createExecutorUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { isErr, Ok } from "~/shared/result";

import { assignContacts } from "./application/assign-contacts";
import { completeContactHoldCall } from "./application/complete-contact-hold-call";

type ContactHoldRepos = {
  users: ReturnType<typeof createCapacityUsersRepo>;
  drawPolicyDefaults: ReturnType<typeof createDrawPolicyDefaultsRepo>;
  drawPolicyOverrides: ReturnType<typeof createDrawPolicyOverridesRepo>;
  drawCapacityGrants: CapacityGrantsRepo;
  drawUsageReservations: CapacityReservationsRepo;
  drawUsageCommits: CapacityCommitsRepo;
  contactHolds: ReturnType<typeof createContactHoldsRepo>;
  organization: ReturnType<typeof createOrganizationRepo>;
  cadence: ReturnType<typeof createContactCadenceRepo>;
};

interface ContactHoldsRuntimeDeps {
  executor: DatabaseExecutor;
  engine: Pick<EngineClient, "requestCandidates">;
}

function buildRepos(executor: DatabaseExecutor): ContactHoldRepos {
  return {
    users: createCapacityUsersRepo(executor),
    drawPolicyDefaults: createDrawPolicyDefaultsRepo(executor),
    drawPolicyOverrides: createDrawPolicyOverridesRepo(executor),
    drawCapacityGrants: createCapacityGrantsRepo(executor, "draw"),
    drawUsageReservations: createCapacityReservationsRepo(executor, "draw"),
    drawUsageCommits: createCapacityCommitsRepo(executor, "draw"),
    contactHolds: createContactHoldsRepo(executor),
    organization: createOrganizationRepo(executor),
    cadence: createContactCadenceRepo(executor),
  };
}

function buildDrawUsageReservationPorts(
  executor: DatabaseExecutor,
): UsageReservationPorts {
  return {
    executor,
    async checkRemaining(trx, actorUserId, operation) {
      const snapshot = await getDrawCapacitySnapshot(
        actorUserId,
        buildRepos(trx),
        operation,
      );
      if (isErr(snapshot)) {
        return snapshot;
      }
      return Ok(snapshot.value.remaining);
    },
    reservations: (trx) => createCapacityReservationsRepo(trx, "draw"),
    commits: (trx) => createCapacityCommitsRepo(trx, "draw"),
  };
}

export function createContactHoldsRuntime(deps: ContactHoldsRuntimeDeps) {
  const { executor, engine } = deps;

  const repos = buildRepos(executor);
  const interactionUow = createExecutorUow(executor, (txDb) => ({
    contactHolds: createContactHoldsRepo(txDb),
    organization: createOrganizationRepo(txDb),
    calls: createCallsRepo(txDb),
  }));
  const uow = createExecutorUow(executor, buildRepos);
  const drawUsageReservationPorts = buildDrawUsageReservationPorts(executor);

  return {
    getCapacity: (
      actorUserId: Parameters<typeof getDrawCapacitySnapshot>[0],
      operation: OperationContext,
    ) => getDrawCapacitySnapshot(actorUserId, repos, operation),
    assign: (
      command: Parameters<typeof assignContacts>[0],
      operation: OperationContext,
    ) =>
      assignContacts(
        command,
        { repos, uow, engine, drawUsageReservationPorts },
        operation,
      ),
    listActive: async (
      actorUserId: Parameters<typeof getDrawCapacitySnapshot>[0],
      operation: OperationContext,
    ) => {
      const rows = await repos.contactHolds.findActiveByUserWithContacts(
        actorUserId,
        operation.operationAt,
      );

      return Ok(
        rows.map((row): MyContactHoldView => ({
          holdId: row.holdId,
          contactId: row.contactId,
          name: row.name,
          phone: row.phonePrimary,
          heldAt: epochMilliseconds(row.heldAt),
          expiresAt: epochMilliseconds(row.expiresAt),
        })),
      );
    },
    completeCall: (
      command: Parameters<typeof completeContactHoldCall>[0],
      operation: OperationContext,
    ) => completeContactHoldCall(command, interactionUow, operation),
  };
}
