/// <reference types="@solidjs/vite-plugin/virtual-modules" />
// The Worker: routes each API request to the Durable Object that holds the
// store it names, and serves the app there. Each object composes its own
// store's application and reaches its peers through `remote` ports, one
// Durable Object call per operation. Static assets never reach this code.
import { constantTimeEqual } from "@oslojs/crypto/subtle";
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
  decodeDump,
  dumpStore,
  encodeDump,
  loadStore,
} from "~/server/platform/database/load";
import { applyMigrations } from "~/server/platform/database/migrate";
import { PLATFORM_MIGRATIONS } from "~/server/platform/database/schema/platform";
import { REGISTRY_MIGRATIONS } from "~/server/platform/database/schema/registry";
import { WORKSPACE_MIGRATIONS } from "~/server/platform/database/schema/workspace";
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

// Moves one store's rows in or out as an encoded dump.
interface Transfer {
  dump(): Promise<string>;
  load(dump: string): Promise<{ rows: number }>;
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
      dump(workspaceId: WorkspaceId): Promise<string>;
      load(workspaceId: WorkspaceId, dump: string): Promise<{ rows: number }>;
    }
  >;
  PLATFORM: ObjectNamespace<Served & Transfer & { invoke: Invoke }>;
  REGISTRY: ObjectNamespace<Transfer & { invoke: Invoke }>;
  // Opens the store routes while set. Provisioning sets it, loads the stores
  // and deletes it.
  LOAD_TOKEN?: string;
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

function registryStub(env: Env) {
  return env.REGISTRY.get(env.REGISTRY.idFromName(REGISTRY_NAME));
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
    registryStub(env).invoke(path, args),
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

const STORE_ROUTE =
  /^\/api\/admin\/stores\/(platform|registry|workspaces\/([^/]+))$/;

function holdsLoadToken(request: Request, env: Env): boolean {
  const authorization = request.headers.get("authorization");
  if (!env.LOAD_TOKEN || !authorization?.startsWith("Bearer ")) {
    return false;
  }
  const encoder = new TextEncoder();
  return constantTimeEqual(
    encoder.encode(authorization.slice(7).trim()),
    encoder.encode(env.LOAD_TOKEN),
  );
}

function storeTransfer(
  env: Env,
  name: string,
  id: string | undefined,
): Transfer | null {
  if (name === PLATFORM_NAME) {
    return platformStub(env);
  }
  if (name === REGISTRY_NAME) {
    return registryStub(env);
  }
  const parsed = WorkspaceId.parse(id);
  if (!parsed.ok) {
    return null;
  }
  const workspaceId = parsed.value;
  const stub = workspaceStub(env, workspaceId);
  return {
    dump: () => stub.dump(workspaceId),
    load: (dump) => stub.load(workspaceId, dump),
  };
}

// `GET` returns a store's dump and `PUT` loads one into it. Without the load
// token the routes do not exist.
async function storeRoute(
  request: Request,
  env: Env,
  match: RegExpExecArray,
): Promise<Response> {
  const transfer = holdsLoadToken(request, env)
    ? storeTransfer(env, match[1] ?? "", match[2])
    : null;
  if (!transfer) {
    return new Response(null, { status: 404 });
  }
  try {
    if (request.method === "GET") {
      return new Response(await transfer.dump(), {
        headers: { "content-type": "application/json" },
      });
    }
    if (request.method === "PUT") {
      return Response.json(await transfer.load(await request.text()));
    }
    return new Response(null, { status: 405 });
  } catch (error) {
    return new Response(String(error), { status: 409 });
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const store = STORE_ROUTE.exec(pathname);
    if (store) {
      return storeRoute(request, env, store);
    }
    return pathname.startsWith("/api/") || pathname.startsWith("/_server")
      ? route(request, env)
      : env.ASSETS.fetch(request);
  },
};

// The store of one object, migrated, as a dump endpoint. `reset` drops what
// the object composed over the store, so the next call reads the loaded rows.
function objectTransfer(
  storage: import("cloudflare:workers").DurableObjectState["storage"],
  migrations: readonly (readonly string[])[],
  reset: () => void,
): Transfer {
  const migrated = async () => {
    const store = createDurableObjectStore(storage);
    await applyMigrations(store, migrations);
    return store;
  };
  return {
    dump: async () => encodeDump(dumpStore(await migrated(), migrations)),
    load: async (dump) => {
      const loaded = await loadStore(
        await migrated(),
        migrations,
        decodeDump(dump),
      );
      reset();
      return loaded;
    },
  };
}

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
    this.#checkHolds(workspaceId);
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

  #checkHolds(workspaceId: WorkspaceId): void {
    if (!this.ctx.id.equals(this.env.WORKSPACE.idFromName(workspaceId))) {
      throw new Error("workspace_mismatch");
    }
  }

  #transfer(workspaceId: WorkspaceId): Transfer {
    this.#checkHolds(workspaceId);
    return objectTransfer(this.ctx.storage, WORKSPACE_MIGRATIONS, () => {
      this.#opened = null;
    });
  }

  dump(workspaceId: WorkspaceId): Promise<string> {
    return this.#transfer(workspaceId).dump();
  }

  load(workspaceId: WorkspaceId, dump: string): Promise<{ rows: number }> {
    return this.#transfer(workspaceId).load(dump);
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

  #transfer = objectTransfer(this.ctx.storage, PLATFORM_MIGRATIONS, () => {
    this.#application = null;
  });

  dump(): Promise<string> {
    return this.#transfer.dump();
  }

  load(dump: string): Promise<{ rows: number }> {
    return this.#transfer.load(dump);
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

  #transfer = objectTransfer(this.ctx.storage, REGISTRY_MIGRATIONS, () => {
    this.#client = null;
  });

  dump(): Promise<string> {
    return this.#transfer.dump();
  }

  load(dump: string): Promise<{ rows: number }> {
    return this.#transfer.load(dump);
  }
}
