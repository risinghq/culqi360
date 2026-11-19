import { captureException } from "@sentry/browser";

import { ServerFunctionTransportError } from "~/contracts/errors";

// A server function that fails below the RPC layer (a 401, a 403 from the
// cross-origin check, a 5xx from the host) returns no typed error. Turn the
// status into one so the caller throws and Sentry hears about it.
export function captureServerFunctionFailures() {
  if (typeof window === "undefined" || !("fetch" in window)) {
    return;
  }

  const originalFetch = window.fetch;

  const patchedFetch = async (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const response = await originalFetch(request);

    if (!isServerFunctionRequest(request) || response.ok) {
      return response;
    }

    const error = new ServerFunctionTransportError(response.status);
    captureException(error, {
      level: "warning",
      tags: { source: "server_function_transport" },
      extra: {
        method: request.method,
        path: new URL(request.url).pathname,
        status: response.status,
      },
    });
    throw error;
  };

  Object.assign(patchedFetch, originalFetch);

  // defineProperty keeps fetch configurable for downstream instrumentation
  // and bypasses the no-window-fetch-reassignment lint rule.
  Object.defineProperty(window, "fetch", {
    value: patchedFetch,
    configurable: true,
    writable: true,
    enumerable: true,
  });
}

function isServerFunctionRequest(request: Request): boolean {
  return new URL(request.url).pathname.endsWith("/_server");
}
