// Sentry options for the Worker and its Durable Objects. The SDK takes them
// per isolate from these callbacks, since Workers has no process start to run
// `init` at. Without `SENTRY_DSN` the client stays disabled.
import type { CloudflareOptions } from "@sentry/cloudflare";

import { sentryConfig } from "~/server/platform/config/env";
import { sentryDefaultDataCollection } from "~/shared/observability/sentry";

export function workerSentryOptions(): CloudflareOptions {
  const { sentryDsn, sentryTraceSampleRate } = sentryConfig();
  return {
    dsn: sentryDsn,
    enabled: sentryDsn !== "",
    tracesSampleRate: Number(sentryTraceSampleRate),
    dataCollection: sentryDefaultDataCollection(),
  };
}
