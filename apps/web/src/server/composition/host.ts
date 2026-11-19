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
  const platformStore = await openPlatformStore(openStore("platform"));
  const registryStore = await openRegistryStore(openStore("registry"));
  const platformDb = platformStore.db;
  const registryDb = registryStore.db;

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
  const platformInfrastructure: PlatformInfrastructure = {
    db: platformDb,
    logger: createLogger("platform"),
  };
  const platform = createPlatformApplication(platformInfrastructure, {
    workspace: async (workspaceId) => (await workspace(workspaceId)).inbound,
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
        ).inbound.applyEnrichment(projection);
      },
      async publish(workspaceId, status) {
        await (await workspace(workspaceId)).inbound.publishEnrichment(status);
      },
    },
  });

  const workspaces = new Map<WorkspaceId, Promise<WorkspaceApplication>>();
  const openedListeners = new Set<(workspaceId: WorkspaceId) => void>();
  function workspace(workspaceId: WorkspaceId): Promise<WorkspaceApplication> {
    let app = workspaces.get(workspaceId);
    if (!app) {
      app = workspaceStore(workspaceId).then((store) =>
        createWorkspaceApplication(store, {
          platform: platform.inbound,
          registry: registry.client,
          messaging,
          engine,
          organizationEnrichment,
          config,
        }),
      );
      workspaces.set(workspaceId, app);
      for (const listener of openedListeners) {
        listener(workspaceId);
      }
    }
    return app;
  }

  return {
    platform,
    workspace,
    registry,
    stores: {
      platform: platformStore,
      registry: registryStore,
      workspace: workspaceStore,
    },
    // Fires once per workspace, when its application is first built.
    onWorkspaceOpened(
      listener: (workspaceId: WorkspaceId) => void,
    ): () => void {
      openedListeners.add(listener);
      return () => openedListeners.delete(listener);
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
