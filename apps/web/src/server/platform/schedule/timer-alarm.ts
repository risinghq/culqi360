import type { CommitEffects } from "~/server/platform/database/commit-effects";

import type { Schedule } from "./schedule";

// setTimeout overflows past 2^31 - 1 ms. A deadline further out fires early,
// finds nothing due, and re-arms.
const MAX_DELAY_MS = 24 * 60 * 60_000;

export interface TimerAlarm {
  stop(): Promise<void>;
}

// The Bun host's stand-in for a Durable Object alarm: one timer per store,
// set to the schedule's next instant. A commit can bring a deadline closer,
// so every commit re-reads it. Commits made by a firing re-arm once, after
// the firing ends.
export function startTimerAlarm(
  schedule: Schedule,
  effects: CommitEffects,
  failed: (error: unknown) => void,
): TimerAlarm {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy: Promise<void> | null = null;
  let rearm = false;

  // Arming and firing share `busy`, so a stale read never replaces the timer
  // a later one set, and a firing never overlaps itself.
  function exclusive(work: () => Promise<void>): void {
    if (stopped) {
      return;
    }
    if (busy) {
      rearm = true;
      return;
    }
    rearm = false;
    busy = work()
      .catch(failed)
      .finally(() => {
        busy = null;
        if (rearm) {
          exclusive(arm);
        }
      });
  }

  async function arm(): Promise<void> {
    // clock-boundary: alarm. The wait is measured against the wall clock.
    const now = new Date();
    const next = await schedule.nextAt(now);
    clearTimeout(timer);
    timer = undefined;
    if (next && !stopped) {
      const delay = Math.min(
        Math.max(0, next.getTime() - Date.now()),
        MAX_DELAY_MS,
      );
      timer = setTimeout(() => exclusive(fire), delay);
    }
  }

  async function fire(): Promise<void> {
    timer = undefined;
    // clock-boundary: alarm. Each firing is its own inbound event, so every
    // row it touches carries the same instant.
    await schedule.runDue(new Date());
    rearm = true;
  }

  const unsubscribe = effects.onCommit(() => exclusive(arm));
  exclusive(arm);

  return {
    async stop() {
      stopped = true;
      unsubscribe();
      clearTimeout(timer);
      await busy;
      await schedule.stop();
    },
  };
}
