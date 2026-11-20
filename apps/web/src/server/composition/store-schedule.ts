import { captureException } from "@sentry/core";

import { createSchedule, type Duty } from "~/server/platform/schedule/schedule";
import { faultMeta } from "~/shared/observability/fault-meta";
import { createLogger } from "~/shared/observability/runtime-logger";

const logger = createLogger("background-jobs");

export function reportAlarmFailure(
  event: string,
  meta: object,
  error: unknown,
): void {
  logger.error(event, { ...meta, ...faultMeta(error) });
  captureException(error);
}

// One store's duties as the schedule its alarm keeps, on either host.
export function createStoreSchedule(store: string, duties: Duty[]) {
  return createSchedule(duties, (duty, error) =>
    reportAlarmFailure("duty_failed", { store, duty }, error),
  );
}
