import type { Kysely } from "kysely";

import type { RegistryDatabase } from "~/server/platform/database/types";

import type { SunatScraperClient } from "./enrichment/sunat/contracts";
import type { CompanyRegistryClient, RegistryWorkspaceSink } from "./ports";
import { createCompanyRegistryRepo } from "./repository";
import { createEnrichmentQuery } from "./status";
import { createEnrichmentQueue, type EngineFallback } from "./worker";

const MAX_ATTEMPTS = 5;

// The host-level registry app. It owns the shared SUNAT records and the queue
// that scrapes them; workspaces reach it through `client`, and it reaches them
// back through the sink once a record settles.
export function createCompanyRegistry(deps: {
  db: Kysely<RegistryDatabase>;
  scraper: SunatScraperClient;
  engineFallback: EngineFallback;
  sink: RegistryWorkspaceSink;
}) {
  const repo = createCompanyRegistryRepo(deps.db);
  const query = createEnrichmentQuery(repo);

  const client: CompanyRegistryClient = {
    async request({ workspaceId, documents, requestedByUserId, operation }) {
      if (documents.length === 0) {
        return;
      }
      const requests = documents.map((document) => ({
        documentType: document.kind,
        documentValue: document.value,
        requestedByUserId,
        requestedAt: operation.operationAt,
        maxAttempts: MAX_ATTEMPTS,
      }));
      await deps.db
        .transaction()
        .execute((trx) =>
          createCompanyRegistryRepo(trx).upsertRequests(requests, workspaceId),
        );
    },
    getStatus: query.getStatus,
  };

  return {
    client,
    createQueue: () =>
      createEnrichmentQueue({
        repo,
        query,
        scraper: deps.scraper,
        engineFallback: deps.engineFallback,
        sink: deps.sink,
      }),
  };
}

export type CompanyRegistry = ReturnType<typeof createCompanyRegistry>;
