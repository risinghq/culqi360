import { getRequestEvent } from "@solidjs/web";

import type { WorkspaceId } from "~/domain/ids";
import { databaseConfig } from "~/server/platform/config/env";
import { fileStores } from "~/server/platform/database/bun-store";

import { createHost, type Host } from "./host";
import type { PlatformApplication } from "./platform-application";
import type { WorkspaceApplication } from "./workspace-application";

export type { PlatformApplication, WorkspaceApplication };

let host: Promise<Host> | undefined;

// Built on first use so importing server modules does not require full
// runtime config.
export function getHost(): Promise<Host> {
  host ??= createHost(fileStores(databaseConfig().dataDir));
  return host;
}

// The host the middleware has already awaited, for synchronous callers inside
// a request.
let readyHost: Host | undefined;

export async function startHost(): Promise<Host> {
  readyHost = await getHost();
  return readyHost;
}

export function getPlatform(): PlatformApplication {
  if (!readyHost) {
    throw new Error("Host not started");
  }
  return readyHost.platform;
}

// The signed-in principal's workspace application, which the middleware puts
// on the request.
export function getApplication(): WorkspaceApplication {
  const application = getRequestEvent()?.locals?.application;
  if (!application) {
    throw new Error("No workspace application on this request");
  }
  return application;
}

export async function openWorkspaceApplication(
  workspaceId: WorkspaceId,
): Promise<WorkspaceApplication> {
  return (await getHost()).workspace(workspaceId);
}

// The workspace an extension credential names. Null when the credential does
// not check out; the route answers 401, which the extension reads as "claim or
// refresh".
export async function openExtensionApplication(
  credential: string,
): Promise<WorkspaceApplication | null> {
  const running = await getHost();
  const workspaceId =
    await running.platform.routing.extensionWorkspace(credential);
  return workspaceId ? running.workspace(workspaceId) : null;
}
