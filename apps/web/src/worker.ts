/// <reference types="@solidjs/vite-plugin/virtual-modules" />
// The Worker: routes each API request to the Durable Object that holds the
// store it names, and serves the app there. Each object composes its own
// store's application and reaches its peers through `remote` ports, one
// Durable Object call per operation. Static assets never reach this code.
import { DurableObject } from "cloudflare:workers";
import { handleRequest } from "virtual:solid-ssr-handler";

import { WorkspaceId } from "~/domain/ids";
import { SESSION_COOKIE_NAME } from "~/server/auth/session/cookies";
import { sessionTokenWorkspace } from "~/server/auth/session/tokens";
import type { CompanyRegistryClient } from "~/server/client-search/ports";
import type {
  PlatformSurface,
  RequestHost,
} from "~/server/composition/application";
import type { WorkspacePorts } from "~/server/composition/platform-application";
import { dispatch, remote, type Invoke } from "~/server/composition/remote";
import {
  composePlatform,
  composeRegistry,
  createHostServices,
  openWorkspaceInfrastructure,
  type HostStorage,
} from "~/server/composition/stores";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "~/server/composition/workspace-application";
import { runInHost } from "~/server/entrypoints/runtime.workers";
import { extensionCredentialWorkspace } from "~/server/extension/crypto";
import { createDurableObjectStore } from "~/server/platform/database/durable-object-store";
import {
  r2Blobs,
  type R2BucketLike,
} from "~/server/platform/files/r2-blob-store";

interface ObjectNamespace<Stub> {
  idFromName(name: string): import("cloudflare:workers").DurableObjectId;
  get(id: import("cloudflare:workers").DurableObjectId): Stub;
}

interface Served {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: Served;
  FILES: R2BucketLike;
  WORKSPACE: ObjectNamespace<
    Served & {
      invoke(
        workspaceId: WorkspaceId,
        path: string[],
        args: unknown[],
      ): Promise<unknown>;
    }
  >;
  PLATFORM: ObjectNamespace<Served & { invoke: Invoke }>;
  REGISTRY: ObjectNamespace<{ invoke: Invoke }>;
}

// Set by the router on the request it forwards to a workspace object. The
// object checks it against its own id, so the header cannot open another
// workspace's store.
const WORKSPACE_HEADER = "x-workspace-id";

// The platform and the registry are one store each.
const PLATFORM_NAME = "platform";
const REGISTRY_NAME = "registry";

function platformStub(env: Env) {
  return env.PLATFORM.get(env.PLATFORM.idFromName(PLATFORM_NAME));
}

function workspaceStub(env: Env, workspaceId: WorkspaceId) {
  return env.WORKSPACE.get(env.WORKSPACE.idFromName(workspaceId));
}

function remotePlatform(env: Env): PlatformSurface {
  return remote<PlatformSurface>((path, args) =>
    platformStub(env).invoke(path, args),
  );
}

function remoteWorkspace(env: Env, workspaceId: WorkspaceId): WorkspacePorts {
  return remote<WorkspacePorts>((path, args) =>
    workspaceStub(env, workspaceId).invoke(workspaceId, path, args),
  );
}

function remoteRegistry(env: Env): CompanyRegistryClient {
  return remote<CompanyRegistryClient>((path, args) =>
    env.REGISTRY.get(env.REGISTRY.idFromName(REGISTRY_NAME)).invoke(path, args),
  );
}

// Each object holds one store, so the store name is not needed.
function objectStorage(
  storage: import("cloudflare:workers").DurableObjectState["storage"],
  env: Env,
): HostStorage {
  return {
    openStore: () => createDurableObjectStore(storage),
    openBlobs: r2Blobs(env.FILES),
  };
}

function readCookie(request: Request, name: string): string | null {
  for (const pair of request.headers.get("cookie")?.split(";") ?? []) {
    const separator = pair.indexOf("=");
    if (separator > 0 && pair.slice(0, separator).trim() === name) {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    }
  }
  return null;
}

// The workspace a request's credential names: the session cookie of a signed-in
// user, or the bearer token every extension request carries. Both are sealed
// under SESSION_SECRET or signed, so a forged one names no workspace.
async function requestWorkspace(request: Request): Promise<WorkspaceId | null> {
  const session = readCookie(request, SESSION_COOKIE_NAME);
  const fromSession = session ? sessionTokenWorkspace(session) : null;
  if (fromSession) {
    return fromSession;
  }
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ")
    ? extensionCredentialWorkspace(authorization.slice(7).trim())
    : null;
}

async function route(request: Request, env: Env): Promise<Response> {
  const workspaceId = await requestWorkspace(request);
  if (!workspaceId) {
    return platformStub(env).fetch(request);
  }
  const forwarded = new Request(request);
  forwarded.headers.set(WORKSPACE_HEADER, workspaceId);
  return workspaceStub(env, workspaceId).fetch(forwarded);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    return pathname.startsWith("/api/") || pathname.startsWith("/_server")
      ? route(request, env)
      : env.ASSETS.fetch(request);
  },
};

export class WorkspaceObject extends DurableObject<Env> {
  #opened: { workspaceId: WorkspaceId; app: WorkspaceApplication } | null =
    null;

  // Composed on the first call, which names the workspace this object holds.
  async #open(workspaceId: WorkspaceId): Promise<WorkspaceApplication> {
    if (this.#opened) {
      if (this.#opened.workspaceId !== workspaceId) {
        throw new Error("workspace_mismatch");
      }
      return this.#opened.app;
    }
    if (!this.ctx.id.equals(this.env.WORKSPACE.idFromName(workspaceId))) {
      throw new Error("workspace_mismatch");
    }
    const services = createHostServices();
    const infrastructure = await openWorkspaceInfrastructure(
      objectStorage(this.ctx.storage, this.env),
      workspaceId,
    );
    // Another call may have composed it while the store opened.
    this.#opened ??= {
      workspaceId,
      app: createWorkspaceApplication(infrastructure, {
        ...services,
        platform: remotePlatform(this.env).inbound,
        registry: remoteRegistry(this.env),
      }),
    };
    return this.#opened.app;
  }

  async fetch(request: Request): Promise<Response> {
    const parsed = WorkspaceId.parse(request.headers.get(WORKSPACE_HEADER));
    if (!parsed.ok) {
      return new Response(null, { status: 400 });
    }
    const workspaceId = parsed.value;
    const app = await this.#open(workspaceId);
    const host: RequestHost = {
      platform: remotePlatform(this.env),
      workspace: (id) =>
        id === workspaceId
          ? Promise.resolve(app)
          : Promise.reject(new Error("workspace_mismatch")),
    };
    return runInHost(host, () => handleRequest(request));
  }

  async invoke(
    workspaceId: WorkspaceId,
    path: string[],
    args: unknown[],
  ): Promise<unknown> {
    return dispatch((await this.#open(workspaceId)).inbound, path, args);
  }
}

export class PlatformObject extends DurableObject<Env> {
  #application: Promise<PlatformSurface> | null = null;

  #open(): Promise<PlatformSurface> {
    this.#application ??= composePlatform(
      objectStorage(this.ctx.storage, this.env),
      createHostServices(),
      async (workspaceId) => remoteWorkspace(this.env, workspaceId),
    ).then(({ application }) => application);
    return this.#application;
  }

  async fetch(request: Request): Promise<Response> {
    const host: RequestHost = {
      platform: await this.#open(),
      // The router sends a request that names a workspace to that
      // workspace's object, so a request here has none.
      workspace: () => Promise.reject(new Error("no_workspace_on_platform")),
    };
    return runInHost(host, () => handleRequest(request));
  }

  async invoke(path: string[], args: unknown[]): Promise<unknown> {
    return dispatch(await this.#open(), path, args);
  }
}

export class RegistryObject extends DurableObject<Env> {
  #client: Promise<CompanyRegistryClient> | null = null;

  async invoke(path: string[], args: unknown[]): Promise<unknown> {
    this.#client ??= composeRegistry(
      objectStorage(this.ctx.storage, this.env).openStore,
      createHostServices(),
      async (workspaceId) => remoteWorkspace(this.env, workspaceId),
    ).then(({ registry }) => registry.client);
    return dispatch(await this.#client, path, args);
  }
}
