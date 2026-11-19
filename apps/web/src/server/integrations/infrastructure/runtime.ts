import type { OrganizationEnrichmentQueue } from "~/server/organization/enrichment";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import { createMembersRepo } from "~/server/users/repos-members";
import { createLeadRepo } from "~/server/workflow/lead/write/lead-repo";

import type { IntegrationRuntime } from "../types";
import { createIntegrationJobRepo } from "./integration-job-repo";

export function createIntegrationRuntime(input: {
  executor: WorkspaceExecutor;
  enrichment: OrganizationEnrichmentQueue;
}): IntegrationRuntime {
  const { executor } = input;

  return {
    executor,
    enrichment: input.enrichment,
    jobs: createIntegrationJobRepo(executor),
    leads: createLeadRepo(executor),
    users: createMembersRepo(executor),
  };
}
