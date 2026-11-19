import type { SearchResult } from "~/contracts/search/engine-results.generated";
import { external } from "~/domain/errors";
import { createCompanyRegistryRepo } from "~/server/client-search/repository";
import { createEnrichmentQuery } from "~/server/client-search/status";
import { createFilesRuntime } from "~/server/files/runtime";
import type { EngineClient } from "~/server/integrations/engine/client";
import { createIntegrationRuntime } from "~/server/integrations/infrastructure/runtime";
import { createOrganizationEnrichment } from "~/server/organization/enrichment";
import type { WorkspaceInfrastructure } from "~/server/platform/infrastructure";
import { createWorkflowRuntime } from "~/server/workflow/runtime";
import { Err } from "~/shared/result";

import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  type TestDbContext,
} from "./db";

type CompanyOverlay = {
  legalName: string | null;
  address?: string | null;
};

function createFakeEngine() {
  const companies = new Map<string, CompanyOverlay>();

  const client: EngineClient = {
    async search(intent, query) {
      if (intent !== "companies") {
        return { ok: true, value: [] };
      }

      const overlay = companies.get(query);
      const value = overlay ? [companyResult(query, overlay)] : [];

      return { ok: true, value };
    },

    async requestCandidates() {
      return { ok: true, value: [] };
    },

    // Ingest is outside this harness, so unsupported calls fail explicitly.
    async registerIngestUpload() {
      return Err(
        external("ingest is not available in the test app runtime", {
          code: "engine_ingest_unsupported",
        }),
      );
    },

    async uploadIngestBlob() {
      return Err(
        external("ingest is not available in the test app runtime", {
          code: "engine_ingest_unsupported",
        }),
      );
    },

    async getIngestJob() {
      return Err(
        external("ingest is not available in the test app runtime", {
          code: "engine_ingest_unsupported",
        }),
      );
    },

    async listIngestSources() {
      return Err(
        external("ingest is not available in the test app runtime", {
          code: "engine_ingest_unsupported",
        }),
      );
    },
  };

  return {
    client,

    company(ruc: string, overlay: CompanyOverlay) {
      companies.set(ruc, overlay);
    },

    clear() {
      companies.clear();
    },
  };
}

function companyResult(ruc: string, overlay: CompanyOverlay): SearchResult {
  return {
    kind: "company",
    company: {
      id: 0,
      ruc,
      legal_name: overlay.legalName,
      trade_name: null,
      company_type: null,
      status: null,
      condition: null,
      fiscal_address: overlay.address ?? null,
      registration_date: null,
      activity_start_date: null,
      line_of_business: null,
      economic_activity: null,
      ubigeo_code: null,
      department: null,
      province: null,
      district: null,
    },
    people: [],
    phones: {
      primary: null,
      secondary: null,
      siblings: null,
    },
  };
}

export function testWorkspaceInfrastructure(
  ctx: TestDbContext,
): WorkspaceInfrastructure {
  return {
    workspaceId: ctx.fixtures.workspace.id,
    db: ctx.db,
    effects: ctx.effects,
    logger: { info() {}, error() {} },
  };
}

export interface TestRuntime {
  ctx: TestDbContext;

  // Fixture clock for tests that model time passing.
  now: {
    get(): Date;
    set(value: Date): void;
  };

  integrations: ReturnType<typeof createIntegrationRuntime>;
  workflow: ReturnType<typeof createWorkflowRuntime>;

  engine: {
    client: EngineClient;
    company(ruc: string, overlay: CompanyOverlay): void;
  };

  reset(): Promise<void>;
  dispose(): Promise<void>;
}

export async function createTestRuntime(prefix: string): Promise<TestRuntime> {
  const ctx = await createIsolatedTestDb(prefix);
  let currentNow = new Date();

  const now = {
    get: () => currentNow,

    set: (value: Date) => {
      currentNow = value;
    },
  };

  const engine = createFakeEngine();

  const infrastructure = testWorkspaceInfrastructure(ctx);
  const files = createFilesRuntime(infrastructure, {
    storageRoot: ctx.storageRoot,
  });
  const enrichmentQueue = { requestRucs: async () => {} };

  const workflow = createWorkflowRuntime(infrastructure, {
    files,
    organizationEnrichment: createOrganizationEnrichment(engine.client),
    enrichmentQueue,
    registry: createEnrichmentQuery(createCompanyRegistryRepo(ctx.registry)),
  });

  const integrations = createIntegrationRuntime({
    executor: ctx.db,
    enrichment: enrichmentQueue,
  });

  return {
    ctx,
    now,
    integrations,
    workflow,

    engine: {
      client: engine.client,
      company: (ruc, overlay) => engine.company(ruc, overlay),
    },

    async reset() {
      await resetTestDb(ctx);
      currentNow = new Date();
      engine.clear();
    },

    async dispose() {
      await cleanupTestDb(ctx);
    },
  };
}
