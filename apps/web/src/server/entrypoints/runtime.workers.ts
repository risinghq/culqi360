// The Worker's runtime, which a Workers build puts in place of runtime.ts. One
// isolate can run several Durable Objects, so no module-level host exists: the
// object serving a request runs the app inside its own host's scope.
import { AsyncLocalStorage } from "node:async_hooks";

import type { RequestHost } from "~/server/composition/application";

const scope = new AsyncLocalStorage<RequestHost>();

export function runInHost<T>(host: RequestHost, serve: () => T): T {
  return scope.run(host, serve);
}

export function requestHost(): Promise<RequestHost> {
  const host = scope.getStore();
  if (!host) {
    return Promise.reject(new Error("Request served outside a host scope"));
  }
  return Promise.resolve(host);
}
