import { join } from "node:path";

import type { WorkspaceId } from "~/domain/ids";
import { createSunatScraperClient } from "~/server/client-search/enrichment/sunat/client";
import { createCompanyRegistry } from "~/server/client-search/registry";
import { createDefaultEngineClient } from "~/server/integrations/engine/client";
import { createNotificationMessaging } from "~/server/notifications/runtime";
import { createOrganizationEnrichment } from "~/server/organization/enrichment";
import {
  appConfig,
  engineConfig,
  notificationsConfig,
  uploadsConfig,
} from "~/server/platform/config/env";
import {
  openPlatformStore,
  openRegistryStore,
  openWorkspaceStore,
} from "~/server/platform/database/open-store";
import {
  workspaceStoreName,
  type StoreOpener,
} from "~/server/platform/database/store";
import { createBlobStore } from "~/server/platform/files/blob-store";
import type {
  PlatformInfrastructure,
  WorkspaceInfrastructure,
} from "~/server/platform/infrastructure";
import { createLogger } from "~/shared/observability/runtime-logger";

import { createPlatformApplication } from "./platform-application";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "./workspace-application";

// One process holding the platform, the registry and every workspace store,
// with the applications built over them. The Worker splits the same
// applications across Durable Objects; the ports between them are async here
// for that reason.
export async function createHost(openStore: StoreOpener) {
  const platformDb = await openPlatformStore(openStore("platform"));
  const registryDb = await openRegistryStore(openStore("registry"));

  const config = {
    app: appConfig(),
    notifications: notificationsConfig(),
    uploads: uploadsConfig(),
  };
  const messaging = createNotificationMessaging(config.notifications);
  const engine = createDefaultEngineClient(engineConfig());
  const organizationEnrichment = createOrganizationEnrichment(engine);

  const workspaceStores = new Map<
    WorkspaceId,
    Promise<WorkspaceInfrastructure>
  >();
  function workspaceStore(
    workspaceId: WorkspaceId,
  ): Promise<WorkspaceInfrastructure> {
    let opened = workspaceStores.get(workspaceId);
    if (!opened) {
      opened = openWorkspaceStore(
        openStore(workspaceStoreName(workspaceId)),
      ).then(({ db, effects }) => ({
        workspaceId,
        db,
        effects,
        logger: createLogger(`workspace:${workspaceId}`),
      }));
      workspaceStores.set(workspaceId, opened);
    }
    return opened;
  }
  const workspaceDb = async (workspaceId: WorkspaceId) =>
    (await workspaceStore(workspaceId)).db;

  const platformInfrastructure: PlatformInfrastructure = {
    db: platformDb,
    registry: registryDb,
    logger: createLogger("platform"),
  };
  const platform = createPlatformApplication(platformInfrastructure, {
    workspaceDb,
    messaging,
    avatarStore: createBlobStore(join(config.uploads.storageRoot, "avatars")),
    notifications: config.notifications,
  });

  const registry = createCompanyRegistry({
    db: registryDb,
    scraper: createSunatScraperClient(),
    engineFallback: (ruc) => organizationEnrichment.enrichByRuc(ruc),
    sink: {
      async project(workspaceId, projection) {
        await (
          await workspace(workspaceId)
        ).clientSearch.applyEnrichment(projection);
      },
      async publish(workspaceId, status) {
        await (
          await workspace(workspaceId)
        ).clientSearch.publishEnrichment(status);
      },
    },
  });

  const workspaces = new Map<WorkspaceId, Promise<WorkspaceApplication>>();
  function workspace(workspaceId: WorkspaceId): Promise<WorkspaceApplication> {
    let app = workspaces.get(workspaceId);
    if (!app) {
      app = workspaceStore(workspaceId).then((store) =>
        createWorkspaceApplication(store, {
          platformDb,
          registry: registry.client,
          messaging,
          engine,
          organizationEnrichment,
          avatars: platform.avatars,
          config,
        }),
      );
      workspaces.set(workspaceId, app);
    }
    return app;
  }

  return {
    platform,
    workspace,
    registry,
    stores: {
      platform: platformDb,
      registry: registryDb,
      workspace: workspaceStore,
    },
    async listWorkspaceIds(): Promise<WorkspaceId[]> {
      const rows = await platformDb
        .selectFrom("workspaces")
        .select("id")
        .execute();
      return rows.map((row) => row.id);
    },
    async stop(): Promise<void> {
      for (const app of await Promise.all(workspaces.values())) {
        app.ingestJobs.stop();
        app.realtime.stop();
      }
    },
  };
}

export type Host = Awaited<ReturnType<typeof createHost>>;
