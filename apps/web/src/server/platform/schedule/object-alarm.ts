import type { CommitEffects } from "~/server/platform/database/commit-effects";

import type { Schedule } from "./schedule";

// The part of a Durable Object's `ctx.storage` the alarm uses.
export interface AlarmStorage {
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

export interface ObjectAlarm {
  // Ends an invocation: re-arms when a commit since the last arm may have
  // moved a deadline. A read-only invocation costs nothing.
  settle(now: Date): Promise<void>;
  // The object's `alarm()` handler.
  fire(now: Date): Promise<void>;
}

// A Durable Object has one alarm, kept at the schedule's next instant. Arms
// run one at a time, because an object interleaves invocations at every
// remote call, and a stale arm finishing last would hide a closer deadline.
export function createObjectAlarm(
  schedule: Schedule,
  effects: CommitEffects,
  storage: AlarmStorage,
): ObjectAlarm {
  // A freshly opened object has not read its deadlines yet.
  let dirty = true;
  let armed: Promise<void> = Promise.resolve();
  effects.onCommit(() => {
    dirty = true;
  });

  async function arm(now: Date): Promise<void> {
    dirty = false;
    const next = await schedule.nextAt(now);
    const current = await storage.getAlarm();
    if (next === null) {
      if (current !== null) {
        await storage.deleteAlarm();
      }
      return;
    }
    if (current !== next.getTime()) {
      await storage.setAlarm(next.getTime());
    }
  }

  function exclusive(work: () => Promise<void>): Promise<void> {
    const run = armed.then(work);
    armed = run.catch(() => undefined);
    return run;
  }

  return {
    settle: (now) => (dirty ? exclusive(() => arm(now)) : armed),
    fire: (now) =>
      exclusive(async () => {
        await schedule.runDue(now);
        await arm(now);
      }),
  };
}
