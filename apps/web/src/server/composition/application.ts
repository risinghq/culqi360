import { getRequestEvent } from "@solidjs/web";

import type { WorkspaceId } from "~/domain/ids";
import { extensionCredentialWorkspace } from "~/server/extension/crypto";

import type { PlatformApplication } from "./platform-application";
import type { WorkspaceApplication } from "./workspace-application";

export type { PlatformApplication, WorkspaceApplication };

// The applications a request can reach. On Bun one process holds them all. In
// a Worker the Durable Object that serves the request holds its own store's
// application, and reaches the others through their ports.
export interface RequestHost {
  platform: PlatformApplication;
  workspace(workspaceId: WorkspaceId): Promise<WorkspaceApplication>;
}

// The middleware puts the runtime's host on every request it serves.
function requestHost(): RequestHost {
  const host = getRequestEvent()?.locals?.host;
  if (!host) {
    throw new Error("No host on this request");
  }
  return host;
}

export function getPlatform(): PlatformApplication {
  return requestHost().platform;
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

// The workspace an extension credential names. Null when the credential does
// not check out; the route answers 401, which the extension reads as "claim or
// refresh".
export async function openExtensionApplication(
  credential: string,
): Promise<WorkspaceApplication | null> {
  const workspaceId = await extensionCredentialWorkspace(credential);
  return workspaceId ? requestHost().workspace(workspaceId) : null;
}
