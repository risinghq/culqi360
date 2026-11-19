// Process-level lifecycle for the Bun server: validating configuration,
// starting Sentry, the host and its background work, draining them on a signal,
// and the last-resort rejection handler. Start mode has no framework process
// hook, so the first request that needs the host starts it. A page request never
// does, which lets the build prerender the document shell with no secrets and no
// database.
import { captureException, init } from "@sentry/bun";

import { startHost } from "~/server/composition/application";
import { startHostMaintenance } from "~/server/composition/host-maintenance";
import {
  sentryConfig,
  validateServerConfig,
} from "~/server/platform/config/env";
import { faultMeta } from "~/shared/observability/fault-meta";
import { isProduction } from "~/shared/observability/runtime-env";
import { createLogger } from "~/shared/observability/runtime-logger";
import { sentryDefaultDataCollection } from "~/shared/observability/sentry";

const logger = createLogger("server-runtime");

interface RunningHost {
  host: Awaited<ReturnType<typeof startHost>>;
  maintenance: ReturnType<typeof startHostMaintenance>;
}

let running: Promise<RunningHost> | null = null;
let stopping = false;

export function runningHost(): Promise<RunningHost> {
  running ??= start();
  return running;
}

async function start(): Promise<RunningHost> {
  validateServerConfig();
  startSentry();

  const host = await startHost();
  const maintenance = startHostMaintenance(host);

  process.once("SIGINT", (signal) => void shutdown(signal));
  process.once("SIGTERM", (signal) => void shutdown(signal));

  // Bun exits the process on an unhandled rejection; one request's floating
  // promise must not take down every other in-flight request. Logged rather
  // than swallowed, because an entry here is a bug worth fixing at its source.
  process.on("unhandledRejection", (reason: unknown) => {
    logger.error("unhandled_rejection", faultMeta(reason));
    captureException(reason);
  });

  return { host, maintenance };
}

function startSentry(): void {
  if (!isProduction()) {
    return;
  }

  const { sentryDsn, sentryTraceSampleRate } = sentryConfig();

  init({
    dsn: sentryDsn,
    tracesSampleRate: Number(sentryTraceSampleRate),
    dataCollection: sentryDefaultDataCollection(),
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping || !running) {
    return;
  }

  stopping = true;
  logger.info("host_stopping", { signal });

  const { host, maintenance } = await running;
  await maintenance.stop();
  // Stops the engine poll loops before the streams they feed go away.
  await host.stop();

  process.exit(0);
}
