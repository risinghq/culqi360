import { QUERY_KEYS } from "~/contracts/query-keys";
import type { Ruc } from "~/domain/identity/document";
import { publishJobEvent } from "~/server/jobs/publish";
import type { WorkspaceInfrastructure } from "~/server/platform/infrastructure";
import type { OperationContext } from "~/server/platform/operation/context";
import type { RealtimePublisher } from "~/server/realtime/runtime";

import { buildEnrichmentJobEvent } from "./job-event";
import type { EnrichmentStatus } from "./model";
import type { CompanyRegistryClient, OrganizationProjection } from "./ports";

// One workspace's view of the company registry: it asks for lookups, reads
// their status, and takes the results the registry fans back to it.
export function createClientSearchRuntime(
  workspace: WorkspaceInfrastructure,
  deps: {
    registry: CompanyRegistryClient;
    realtime: RealtimePublisher;
    projectOrganization: (input: OrganizationProjection) => Promise<void>;
  },
) {
  const { registry, realtime } = deps;

  return {
    // Call after the workspace transaction commits: the registry is another
    // store. A request lost to a crash is recovered by "Actualizar SUNAT".
    requestRucs: (
      rucs: readonly Ruc[],
      requestedByUserId: string | null,
      operation: OperationContext,
    ) =>
      registry.request({
        workspaceId: workspace.workspaceId,
        documents: rucs.map((ruc) => ({ kind: "ruc" as const, value: ruc })),
        requestedByUserId,
        operation,
      }),

    getEnrichmentStatus: registry.getStatus,

    // Freshness is irrelevant to a subscriber: it is watching the scrape, not
    // deciding whether to start one, so the clock passed here does not matter.
    getEnrichmentJobEvent: async (ruc: Ruc) =>
      buildEnrichmentJobEvent(
        await registry.getStatus({ kind: "ruc", value: ruc }, new Date()),
      ),

    applyEnrichment: deps.projectOrganization,

    // A settled scrape rewrites the organization behind every lead on this
    // document, so both reads that show it are stale.
    publishEnrichment: async (status: EnrichmentStatus) => {
      publishJobEvent(
        realtime,
        workspace.db,
        buildEnrichmentJobEvent(status, [
          QUERY_KEYS.workflow.leadDetail,
          QUERY_KEYS.workflow.leadList,
        ]),
      );
    },
  };
}

export type ClientSearchRuntime = ReturnType<typeof createClientSearchRuntime>;
