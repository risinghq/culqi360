import type { Kysely } from "kysely";

import { createCampaignsRepo } from "~/server/campaigns/infrastructure/campaigns-repo";
import type { CasesRuntime } from "~/server/cases/runtime";
import { createContactHoldsRepo } from "~/server/contacts/infrastructure/hold-repo";
import { createOrganizationRepo } from "~/server/organization/organization-repo";
import type { Database } from "~/server/platform/database/types";

import {
  resolveCallTarget,
  type CallActor,
  type CallRequest,
  type CallTargetPorts,
} from "./application/resolve-call-target";

export function createCallsRuntime(deps: {
  executor: Kysely<Database>;
  cases: Pick<CasesRuntime, "read">;
}) {
  const ports: CallTargetPorts = {
    contactHolds: createContactHoldsRepo(deps.executor),
    organization: createOrganizationRepo(deps.executor),
    campaigns: createCampaignsRepo(deps.executor),
    cases: deps.cases,
  };

  return {
    resolveTarget: (actor: CallActor, request: CallRequest, at: Date) =>
      resolveCallTarget(ports, actor, request, at),
  };
}

export type CallsRuntime = ReturnType<typeof createCallsRuntime>;
