import { captureException } from "@sentry/bun";

import type { WorkspaceId } from "~/domain/ids";
import type { QueueRunner } from "~/server/platform/jobs/types";
import type { OperationContext } from "~/server/platform/operation/context";
import { faultMeta } from "~/shared/observability/fault-meta";
import { createLogger } from "~/shared/observability/runtime-logger";

import type { Host } from "./host";
import type { WorkspaceApplication } from "./workspace-application";

// Queues wake on this poll alone until the workspace object's alarms run them.
const POLL_FLOOR_MS = 1_000;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const logger = createLogger("background-jobs");

type WorkspaceTick = (
  app: WorkspaceApplication,
  context: OperationContext,
) => Promise<void>;

// Each tick runs once per workspace. The recording sweep's interval is the
// worst-case lateness of finalizing an idle recording, on top of the idle
// timeout itself.
const WORKSPACE_TICKS: ReadonlyArray<{
  label: string;
  intervalMs: number;
  run: WorkspaceTick;
}> = [
  {
    label: "account-expiry",
    intervalMs: MINUTE_MS,
    run: (app, context) =>
      app.maintenance.accountLifecycle.expireAccounts(context),
  },
  {
    label: "expiry-notification",
    intervalMs: DAY_MS,
    run: (app, context) =>
      app.maintenance.accountLifecycle.notifyExpiringAccounts(context),
  },
  {
    label: "reservation-sweep",
    intervalMs: MINUTE_MS,
    run: (app, context) =>
      app.maintenance.leadReservation.sweepReservations(context),
  },
  {
    label: "case-timeout-sweep",
    intervalMs: MINUTE_MS,
    run: (app, context) => app.maintenance.caseTimeout.sweepTimeouts(context),
  },
  {
    label: "extension-recording-sweep",
    intervalMs: MINUTE_MS,
    run: async (app, context) => {
      const swept = await app.maintenance.sweepExtensionRecordings(context);
      if (swept.interruptedRecordings > 0 || swept.endedCalls > 0) {
        logger.info("extension_recordings_swept", {
          workspaceId: app.workspaceId,
          ...swept,
        });
      }
    },
  },
  {
    label: "workspace-cleanup",
    intervalMs: 60 * MINUTE_MS,
    run: (app, context) => app.maintenance.cleanup(context),
  },
];

function reportFailure(event: string, meta: object, error: unknown): void {
  logger.error(event, { ...meta, ...faultMeta(error) });
  captureException(error);
}

function workspaceQueues(app: WorkspaceApplication): QueueRunner[] {
  const notifications = app.notifications.createQueues();
  return [
    app.maintenance.createRecordsImportQueue(),
    app.merchantStats.imports.createQueue(),
    notifications.expansion,
    notifications.dispatch,
    notifications.whatsappInbound,
    notifications.outboundWhatsApp,
  ];
}

// Drains one queue at a time per runner; a wake during a drain runs one more.
function makeWaker(run: () => Promise<void>) {
  let stopped = false;
  let active: Promise<void> | null = null;
  let followUp = false;

  const schedule = (): void => {
    if (stopped || active) {
      return;
    }
    followUp = false;
    active = run()
      .catch((error: unknown) => reportFailure("queue_run_failed", {}, error))
      .finally(() => {
        active = null;
        if (followUp) {
          schedule();
        }
      });
  };

  return {
    wake(): void {
      if (!stopped) {
        followUp = true;
        schedule();
      }
    },
    async stop(): Promise<void> {
      stopped = true;
      followUp = false;
      await active;
    },
  };
}

function startTick(
  label: string,
  intervalMs: number,
  run: (context: OperationContext) => Promise<void>,
) {
  let stopped = false;
  let active: Promise<void> | null = null;

  const trigger = (): void => {
    if (stopped || active) {
      return;
    }
    // clock-boundary: scheduled tick. Each firing is its own inbound event,
    // so every row this sweep touches carries the same instant.
    active = run({ operationAt: new Date() })
      .catch((error: unknown) =>
        reportFailure("scheduled_tick_failed", { tick: label }, error),
      )
      .finally(() => {
        active = null;
      });
  };

  trigger();
  const timer = setInterval(trigger, intervalMs);

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      await active;
    },
  };
}

// The Bun host's background work: the platform cleanup, the registry's
// enrichment queue, and every workspace's sweeps and queues. The Worker runs
// the same calls from each Durable Object's alarm instead.
export function startHostMaintenance(host: Host): { stop(): Promise<void> } {
  logger.info("background_jobs_initializing");

  const queues = new Map<string, QueueRunner>();
  const wakers = new Map<string, ReturnType<typeof makeWaker>>();

  function wake(key: string, queue: () => QueueRunner): void {
    let waker = wakers.get(key);
    if (!waker) {
      const runner = queue();
      queues.set(key, runner);
      waker = makeWaker(() => runner.drain());
      wakers.set(key, waker);
    }
    waker.wake();
  }

  async function forEachWorkspace(
    label: string,
    run: (app: WorkspaceApplication) => Promise<void>,
  ): Promise<void> {
    const workspaceIds = await host.listWorkspaceIds();
    await Promise.all(
      workspaceIds.map(async (workspaceId) => {
        try {
          await run(await host.workspace(workspaceId));
        } catch (error) {
          reportFailure("workspace_task_failed", { label, workspaceId }, error);
        }
      }),
    );
  }

  const registryQueue = host.registry.createQueue();
  const workspaceRunners = new Map<WorkspaceId, QueueRunner[]>();

  async function wakeAll(): Promise<void> {
    wake("registry:enrichment", () => registryQueue);
    await forEachWorkspace("queues", async (app) => {
      let runners = workspaceRunners.get(app.workspaceId);
      if (!runners) {
        runners = workspaceQueues(app);
        workspaceRunners.set(app.workspaceId, runners);
      }
      for (const [index, runner] of runners.entries()) {
        wake(`${app.workspaceId}:${index}`, () => runner);
      }
    });
  }

  const ticks = [
    startTick("platform-cleanup", 60 * MINUTE_MS, host.platform.cleanup),
    ...WORKSPACE_TICKS.map(({ label, intervalMs, run }) =>
      startTick(label, intervalMs, (context) =>
        forEachWorkspace(label, (app) => run(app, context)),
      ),
    ),
  ];

  const poll = startTick("queue-poll", POLL_FLOOR_MS, wakeAll);

  let stopping: Promise<void> | null = null;
  return {
    stop(): Promise<void> {
      stopping ??= (async () => {
        await poll.stop();
        await Promise.all([
          ...ticks.map((tick) => tick.stop()),
          ...[...queues.values()].map((queue) => queue.stop()),
          ...[...wakers.values()].map((waker) => waker.stop()),
        ]);
      })();
      return stopping;
    },
  };
}
