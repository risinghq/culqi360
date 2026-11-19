import { hydrateRuc } from "~/domain/identity/document";
import type { SunatScraperClient } from "~/server/client-search/enrichment/sunat/contracts";
import type { Overlay } from "~/server/client-search/model";
import type {
  CompanyRegistryRepo,
  RegistryRow,
  RegistryWorkspaceSink,
} from "~/server/client-search/ports";
import {
  processEnrichmentJob,
  overlayToPatch,
} from "~/server/client-search/process";
import { createJobQueue } from "~/server/platform/jobs/job-queue";

import type { EnrichmentQuery } from "./status";

// SUNAT-unreachable fallback: supplies legal name + address only. The
// degraded record expires quickly so the next refresh re-attempts the
// authoritative scrape.
export type EngineFallback = (
  ruc: string,
) => Promise<{ legalName: string | null; address: string | null } | null>;

type EnrichmentWorkerDeps = {
  repo: CompanyRegistryRepo;
  query: EnrichmentQuery;
  scraper: SunatScraperClient;
  engineFallback: EngineFallback;
  sink: RegistryWorkspaceSink;
};

const DEGRADED_TTL_MS = 60 * 60 * 1000; // 1 hour

export function createEnrichmentQueue(deps: EnrichmentWorkerDeps) {
  const { repo, query, scraper, engineFallback, sink } = deps;

  // Each subscribing workspace gets the organization fields. The projection is
  // idempotent, so a failure in any workspace rethrows and the job retries for
  // all of them.
  async function project(job: RegistryRow, overlay: Overlay): Promise<void> {
    if (overlay.documentType !== "ruc") {
      return;
    }
    const projection = {
      ruc: overlay.documentValue,
      legalName: overlay.legalName,
      address: overlay.address,
      district: overlay.district,
      department: overlay.department,
    };
    const subscribers = await repo.listSubscribers(job.id);
    await Promise.all(
      subscribers.map((workspaceId) => sink.project(workspaceId, projection)),
    );
  }

  async function fallbackOverlay(job: RegistryRow): Promise<Overlay | null> {
    if (job.document_type !== "ruc") {
      return null;
    }
    const hit = await engineFallback(job.document_value);
    if (!hit) {
      return null;
    }
    // The Engine response is an external observation, not a consequence of
    // claiming this job. Its freshness window starts when that response is
    // received, so a slow fallback cannot be stored as already stale.
    const fetchedAt = new Date(); // clock-boundary: external engine observation
    return {
      documentType: "ruc",
      documentValue: job.document_value,
      fullName: null,
      legalName: hit.legalName,
      address: hit.address,
      district: null,
      department: null,
      contributorStatus: null,
      contributorCondition: null,
      economicActivities: [],
      source: "engine",
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + DEGRADED_TTL_MS),
      payload: null,
    };
  }

  return createJobQueue<RegistryRow>({
    name: "enrichment",
    maxConcurrency: 3,
    store: repo.store,

    // A settled scrape rewrites the organization behind every lead on this
    // document in each subscribing workspace. A publish is a realtime hint, so
    // one workspace failing to take it does not hold back the others.
    onSettled: async (job) => {
      if (job.document_type !== "ruc") {
        return;
      }

      const status = await query.getStatus(
        { kind: "ruc", value: hydrateRuc(job.document_value) },
        new Date(),
      );
      const subscribers = await repo.listSubscribers(job.id);
      await Promise.allSettled(
        subscribers.map((workspaceId) => sink.publish(workspaceId, status)),
      );
    },

    handle: async (job, context) => {
      const result = await processEnrichmentJob(
        job,
        scraper,
        context.abortSignal,
      );

      if (result.ok) {
        // Result columns ride the engine's settle.
        await project(job, result.overlay);
        return { kind: "done", patch: overlayToPatch(result.overlay) };
      }

      // SUNAT has no record: settle done with no result.
      if (result.error.kind === "not_found") {
        return { kind: "done" };
      }

      const exhausted = job.attempt_count >= job.max_attempts;
      if (result.shouldRetry && !exhausted) {
        return { kind: "retry", reason: `enrichment:${result.error.kind}` };
      }

      // Engine fallback so the record is not left empty; a miss (or a DNI) is
      // a terminal failure.
      const fallback = await fallbackOverlay(job);
      if (fallback) {
        await project(job, fallback);
        return { kind: "done", patch: overlayToPatch(fallback) };
      }
      return { kind: "fail", reason: `enrichment:${result.error.kind}` };
    },
  });
}
