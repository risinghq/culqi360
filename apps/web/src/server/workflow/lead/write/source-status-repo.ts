import type { Ruc } from "~/domain/identity/document";
import type { Overlay } from "~/server/client-search/model";
import type { CompanyRegistryClient } from "~/server/client-search/ports";
import type {
  LeadSourceStatus,
  SunatSourceStatus,
} from "~/server/workflow/lead/domain/rows";

export type SourceStatusRepository = {
  findByRuc(ruc: Ruc, freshAsOf: Date): Promise<LeadSourceStatus>;
};

function toPipelineSunatStatus(input: {
  lifecycle: "idle" | "queued" | "running" | "succeeded" | "failed";
  freshness: "fresh" | "stale" | "none";
}): SunatSourceStatus {
  if (input.freshness === "stale") {
    return "stale";
  }

  switch (input.lifecycle) {
    case "idle":
      return "idle";
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "succeeded":
      return "completed";
    case "failed":
      return "failed";
    default:
      input.lifecycle satisfies never;
      return "idle";
  }
}

function toPipelineOverlay(
  overlay: Overlay | null,
): Omit<LeadSourceStatus["sunat"], "status"> {
  if (!overlay) {
    return {
      fetchedAt: null,
      district: null,
      department: null,
      contributorStatus: null,
      contributorCondition: null,
      economicActivities: [],
      payloadAvailable: false,
    };
  }

  return {
    fetchedAt: overlay.fetchedAt,
    district: overlay.district,
    department: overlay.department,
    contributorStatus: overlay.contributorStatus,
    contributorCondition: overlay.contributorCondition,
    economicActivities: overlay.economicActivities,
    payloadAvailable: overlay.payload !== null,
  };
}

export function createSourceStatusRepo(
  registry: Pick<CompanyRegistryClient, "getStatus">,
): SourceStatusRepository {
  return {
    async findByRuc(ruc, freshAsOf) {
      const enrichmentStatus = await registry.getStatus(
        { kind: "ruc", value: ruc },
        freshAsOf,
      );
      const overlay = toPipelineOverlay(enrichmentStatus.overlay);

      return {
        sunat: {
          status: toPipelineSunatStatus({
            lifecycle: enrichmentStatus.lifecycle,
            freshness: enrichmentStatus.freshness,
          }),
          ...overlay,
        },
      };
    },
  };
}
