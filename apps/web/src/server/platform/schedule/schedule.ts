import type { OperationContext } from "~/server/platform/operation/context";

const DEFAULT_SPACING_MS = 60_000;

// Work a store does on its own clock: a sweep past a deadline, a queue with a
// claimable job, a cleanup of expired rows. The store's alarm fires at the
// earliest `nextAt` of its duties.
export interface Duty {
  name: string;

  // The earliest instant this duty has work, read from the rows it acts on,
  // or null when it has none.
  nextAt(): Promise<Date | null>;

  run(context: OperationContext): Promise<void>;

  // The least time between two runs. A run can leave its deadline in the past
  // (a send that failed, a stage a write already moved), and the floor keeps
  // that row from firing the alarm in a loop.
  spacingMs?: number;

  stop?(): Promise<void>;
}

export type DutyFailure = (duty: string, error: unknown) => void;

export interface Schedule {
  // The instant the store's alarm should fire, or null when no duty has
  // work. A duty whose `nextAt` fails is retried one spacing after `now`.
  nextAt(now: Date): Promise<Date | null>;
  // Runs every duty due at `at`, in list order, so a duty can leave work for
  // the next one in the same firing.
  runDue(at: Date): Promise<void>;
  stop(): Promise<void>;
}

export function createSchedule(
  duties: readonly Duty[],
  failed: DutyFailure,
): Schedule {
  // In memory: an evicted store loses it and runs each duty once on wake.
  const ranAt = new Map<string, number>();

  const spacing = (duty: Duty) => duty.spacingMs ?? DEFAULT_SPACING_MS;

  async function dueAt(duty: Duty, now: number): Promise<number | null> {
    let next: Date | null;
    try {
      next = await duty.nextAt();
    } catch (error: unknown) {
      failed(duty.name, error);
      return now + spacing(duty);
    }
    if (!next) {
      return null;
    }
    const last = ranAt.get(duty.name);
    const floor = last === undefined ? 0 : last + spacing(duty);
    return Math.max(next.getTime(), floor);
  }

  return {
    async nextAt(now) {
      const times = await Promise.all(
        duties.map((duty) => dueAt(duty, now.getTime())),
      );
      const due = times.filter((time) => time !== null);
      return due.length === 0 ? null : new Date(Math.min(...due));
    },

    async runDue(at) {
      for (const duty of duties) {
        // Sequential by design: list order is the hand-off order.
        // eslint-disable-next-line no-await-in-loop
        const due = await dueAt(duty, at.getTime());
        if (due === null || due > at.getTime()) {
          continue;
        }
        ranAt.set(duty.name, at.getTime());
        try {
          // eslint-disable-next-line no-await-in-loop
          await duty.run({ operationAt: at });
        } catch (error: unknown) {
          failed(duty.name, error);
        }
      }
    },

    async stop() {
      await Promise.all(
        duties.map((duty) => (duty.stop ? duty.stop() : Promise.resolve())),
      );
    },
  };
}
