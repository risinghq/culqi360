import { AsyncLocalStorage } from "node:async_hooks";

import type { WorkspaceId } from "~/domain/ids";

// The scope decides which Postgres role and workspace a connection uses when
// it is reserved. A workspace scope runs as the app role, so row-level
// security limits every workspace table to that workspace. The platform scope
// runs as the connecting owner, which row-level security does not apply to;
// it serves schema builds, anonymous auth flows and cross-workspace sweeps.
// Code with no scope runs as the app role with no workspace and sees no
// workspace rows.
export const APP_ROLE = "work360_app";

// Read by the column default and the row-level security policies.
export const WORKSPACE_SETTING = "app.workspace_id";

export type DatabaseScope =
  | { kind: "workspace"; workspaceId: WorkspaceId }
  | { kind: "platform" };

const storage = new AsyncLocalStorage<DatabaseScope>();

export function runInWorkspace<T>(workspaceId: WorkspaceId, fn: () => T): T {
  return storage.run({ kind: "workspace", workspaceId }, fn);
}

export function runAsPlatform<T>(fn: () => T): T {
  return storage.run({ kind: "platform" }, fn);
}

export function currentScope(): DatabaseScope | undefined {
  return storage.getStore();
}
