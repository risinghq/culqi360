import type { Kysely } from "kysely";

import type { JobEvent } from "~/contracts/jobs/job-event";
import { REALTIME_CHANNELS } from "~/contracts/realtime/channel";
import type { RealtimePublisher } from "~/server/realtime/runtime";

/**
 * Broadcasts a job's current state to its subscribers.
 *
 * Called with the executor that produced the state, so subscribers cannot
 * observe an event before the row it describes is committed.
 */
export function publishJobEvent(
  realtime: RealtimePublisher,
  executor: Kysely<any>,
  event: JobEvent,
): void {
  realtime.publish(executor, REALTIME_CHANNELS.jobs, JSON.stringify(event));
}
