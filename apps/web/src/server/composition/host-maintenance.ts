import { captureException } from "@sentry/core";

import type { WorkspaceId } from "~/domain/ids";
import type { CommitEffects } from "~/server/platform/database/commit-effects";
import { queueDuty } from "~/server/platform/jobs/job-queue";
import { createSchedule, type Duty } from "~/server/platform/schedule/schedule";
import {
  startTimerAlarm,
  type TimerAlarm,
} from "~/server/platform/schedule/timer-alarm";
import { faultMeta } from "~/shared/observability/fault-meta";
import { createLogger } from "~/shared/observability/runtime-logger";

import type { Host } from "./host";

const logger = createLogger("background-jobs");

function reportFailure(event: string, meta: object, error: unknown): void {
  logger.error(event, { ...meta, ...faultMeta(error) });
  captureException(error);
}

function startStoreAlarm(
  store: string,
  duties: Duty[],
  effects: CommitEffects,
): TimerAlarm {
  const schedule = createSchedule(duties, (duty, error) =>
    reportFailure("duty_failed", { store, duty }, error),
  );
  return startTimerAlarm(schedule, effects, (error) =>
    reportFailure("alarm_failed", { store }, error),
  );
}

// The Bun host's background work: one alarm per store, as the Worker gives
// each Durable Object. Every workspace the platform lists gets one at start,
// and a workspace created later gets one when its application is first built.
export function startHostMaintenance(host: Host): { stop(): Promise<void> } {
  logger.info("background_jobs_initializing");

  const alarms: TimerAlarm[] = [
    startStoreAlarm(
      "platform",
      host.platform.createDuties(),
      host.stores.platform.effects,
    ),
    startStoreAlarm(
      "registry",
      [queueDuty(host.registry.createQueue())],
      host.stores.registry.effects,
    ),
  ];
  let stopped = false;
  const starting = new Set<Promise<void>>();

  async function startWorkspace(workspaceId: WorkspaceId): Promise<void> {
    const [app, store] = await Promise.all([
      host.workspace(workspaceId),
      host.stores.workspace(workspaceId),
    ]);
    if (!stopped) {
      alarms.push(
        startStoreAlarm(
          `workspace:${workspaceId}`,
          app.createDuties(),
          store.effects,
        ),
      );
    }
  }

  const tracked = new Set<WorkspaceId>();
  function track(workspaceId: WorkspaceId): void {
    if (stopped || tracked.has(workspaceId)) {
      return;
    }
    tracked.add(workspaceId);
    const started = startWorkspace(workspaceId).catch((error: unknown) =>
      reportFailure("workspace_alarm_failed", { workspaceId }, error),
    );
    starting.add(started);
    void started.finally(() => starting.delete(started));
  }

  const unsubscribe = host.onWorkspaceOpened(track);
  const listed = host
    .listWorkspaceIds()
    .then((ids) => {
      for (const id of ids) {
        track(id);
      }
      return ids.length;
    })
    .catch((error: unknown) =>
      reportFailure("workspace_list_failed", {}, error),
    );

  let stopping: Promise<void> | null = null;
  return {
    stop(): Promise<void> {
      stopping ??= (async () => {
        stopped = true;
        unsubscribe();
        await listed;
        await Promise.all(starting);
        await Promise.all(alarms.map((alarm) => alarm.stop()));
      })();
      return stopping;
    },
  };
}
