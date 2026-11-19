// Process-level lifecycle for the Bun server: starting the host and its
// background work, draining both on a signal, and the last-resort rejection
// handler. Start mode has no framework process hook, so this runs as import
// side effects of middleware.ts, which the handler loads before dispatching
// anything.
import { captureException } from "@sentry/bun";

import { startHost } from "~/server/composition/application";
import { startHostMaintenance } from "~/server/composition/host-maintenance";
import { faultMeta } from "~/shared/observability/fault-meta";
import { createLogger } from "~/shared/observability/runtime-logger";

const logger = createLogger("server-runtime");

export const hostReady = startHost().then((host) => ({
  host,
  maintenance: startHostMaintenance(host),
}));

let stopping = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) {
    return;
  }

  stopping = true;
  logger.info("host_stopping", { signal });

  const { host, maintenance } = await hostReady;
  await maintenance.stop();
  // Stops the engine poll loops before the streams they feed go away.
  await host.stop();

  process.exit(0);
}

process.once("SIGINT", (signal) => void shutdown(signal));
process.once("SIGTERM", (signal) => void shutdown(signal));

// Bun exits the process on an unhandled rejection; one request's floating
// promise must not take down every other in-flight request. Logged rather than
// swallowed, because an entry here is a bug worth fixing at its source.
process.on("unhandledRejection", (reason: unknown) => {
  logger.error("unhandled_rejection", faultMeta(reason));
  captureException(reason);
});
