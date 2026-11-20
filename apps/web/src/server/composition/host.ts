import type { WorkspaceId } from "~/domain/ids";
import type { WorkspaceInfrastructure } from "~/server/platform/infrastructure";
import {
  createMemorySockets,
  type MemorySockets,
} from "~/server/realtime/sockets";

import {
  composePlatform,
  composeRegistry,
  createHostServices,
  openWorkspaceInfrastructure,
  type HostStorage,
} from "./stores";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "./workspace-application";

export type { HostStorage };

// The close code for a server shutting down, from RFC 6455. Clients reconnect.
const GOING_AWAY = 1001;

// One process holding the platform, the registry and every workspace store,
// with their ports wired as direct calls.
export async function createHost(storage: HostStorage) {
  const services = createHostServices();
  const workspacePorts = async (workspaceId: WorkspaceId) =>
    (await workspace(workspaceId)).inbound;
  const platform = await composePlatform(storage, services, workspacePorts);
  const registry = await composeRegistry(
    storage.openStore,
    services,
    workspacePorts,
  );

  const workspaceStores = new Map<
    WorkspaceId,
    Promise<WorkspaceInfrastructure>
  >();
  function workspaceStore(
    workspaceId: WorkspaceId,
  ): Promise<WorkspaceInfrastructure> {
    let opened = workspaceStores.get(workspaceId);
    if (!opened) {
      opened = openWorkspaceInfrastructure(storage, workspaceId);
      workspaceStores.set(workspaceId, opened);
    }
    return opened;
  }

  const workspaces = new Map<WorkspaceId, Promise<WorkspaceApplication>>();
  const sockets: MemorySockets[] = [];
  const openedListeners = new Set<(workspaceId: WorkspaceId) => void>();
  function workspace(workspaceId: WorkspaceId): Promise<WorkspaceApplication> {
    let app = workspaces.get(workspaceId);
    if (!app) {
      const workspaceSockets = createMemorySockets();
      sockets.push(workspaceSockets);
      app = workspaceStore(workspaceId).then((store) =>
        createWorkspaceApplication(
          store,
          {
            ...services,
            platform: platform.application.inbound,
            registry: registry.registry.client,
          },
          workspaceSockets,
        ),
      );
      workspaces.set(workspaceId, app);
      for (const listener of openedListeners) {
        listener(workspaceId);
      }
    }
    return app;
  }

  return {
    platform: platform.application,
    workspace,
    registry: registry.registry,
    stores: {
      platform: platform.store,
      registry: registry.store,
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
      const rows = await platform.store.db
        .selectFrom("workspaces")
        .select("id")
        .execute();
      return rows.map((row) => row.id);
    },
    async stop(): Promise<void> {
      for (const app of await Promise.all(workspaces.values())) {
        app.realtime.stop();
      }
      for (const open of sockets) {
        open.closeAll(GOING_AWAY, "server stopping");
      }
    },
  };
}

export type Host = Awaited<ReturnType<typeof createHost>>;
