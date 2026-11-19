import { afterEach, describe, expect, it, vi } from "vitest";

import { CommitEffects } from "~/server/platform/database/commit-effects";
import {
  createSchedule,
  type Duty,
  type DutyFailure,
} from "~/server/platform/schedule/schedule";
import { startTimerAlarm } from "~/server/platform/schedule/timer-alarm";

const T0 = new Date("2026-11-19T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

function duty(name: string, next: Date | null, overrides: Partial<Duty> = {}) {
  const runs: Date[] = [];
  const state = { next };
  const value: Duty = {
    name,
    nextAt: () => Promise.resolve(state.next),
    run: (context) => {
      runs.push(context.operationAt);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { duty: value, runs, state };
}

describe("schedule", () => {
  it("fires at the earliest deadline among its duties", async () => {
    const a = duty("a", at(5_000));
    const b = duty("b", at(2_000));
    const idle = duty("idle", null);
    const schedule = createSchedule([a.duty, b.duty, idle.duty], vi.fn());

    expect(await schedule.nextAt(T0)).toEqual(at(2_000));
  });

  it("has no deadline when no duty has work", async () => {
    const schedule = createSchedule([duty("idle", null).duty], vi.fn());

    expect(await schedule.nextAt(T0)).toBeNull();
  });

  it("runs only the duties that are due, in list order", async () => {
    const order: string[] = [];
    const track = (name: string, next: Date) =>
      duty(name, next, {
        run: () => {
          order.push(name);
          return Promise.resolve();
        },
      }).duty;
    const schedule = createSchedule(
      [track("first", at(0)), track("later", at(10_000)), track("second", T0)],
      vi.fn(),
    );

    await schedule.runDue(at(1_000));

    expect(order).toEqual(["first", "second"]);
  });

  it("keeps a deadline the run left in the past from firing again inside its spacing", async () => {
    const stuck = duty("stuck", at(0), { spacingMs: 30_000 });
    const schedule = createSchedule([stuck.duty], vi.fn());

    await schedule.runDue(at(1_000));

    expect(await schedule.nextAt(at(1_000))).toEqual(at(31_000));
    await schedule.runDue(at(2_000));
    expect(stuck.runs).toEqual([at(1_000)]);
  });

  it("reports a failed run and still runs the duties after it", async () => {
    const failed = vi.fn<DutyFailure>();
    const broken = duty("broken", T0, {
      run: () => Promise.reject(new Error("boom")),
    });
    const after = duty("after", T0);
    const schedule = createSchedule([broken.duty, after.duty], failed);

    await schedule.runDue(T0);

    expect(failed).toHaveBeenCalledWith("broken", expect.any(Error));
    expect(after.runs).toEqual([T0]);
  });

  it("retries a duty whose deadline cannot be read one spacing later", async () => {
    const failed = vi.fn<DutyFailure>();
    const unreadable = duty("unreadable", null, {
      nextAt: () => Promise.reject(new Error("locked")),
      spacingMs: 5_000,
    });
    const schedule = createSchedule([unreadable.duty], failed);

    expect(await schedule.nextAt(T0)).toEqual(at(5_000));
    expect(failed).toHaveBeenCalledWith("unreadable", expect.any(Error));
  });
});

describe("timer alarm", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs a duty at its deadline and re-arms when a commit brings one closer", async () => {
    vi.useFakeTimers({ now: T0 });
    const effects = new CommitEffects();
    const job = duty("job", null);
    const alarm = startTimerAlarm(
      createSchedule([job.duty], vi.fn()),
      effects,
      vi.fn(),
    );

    await vi.advanceTimersByTimeAsync(60_000);
    expect(job.runs).toEqual([]);

    job.state.next = at(65_000);
    effects.commit();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(job.runs).toEqual([]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(job.runs).toEqual([at(65_000)]);

    await alarm.stop();
  });

  it("fires no more after it stops", async () => {
    vi.useFakeTimers({ now: T0 });
    const job = duty("job", at(1_000));
    const stop = vi.fn<() => Promise<void>>(() => Promise.resolve());
    job.duty.stop = stop;
    const alarm = startTimerAlarm(
      createSchedule([job.duty], vi.fn()),
      new CommitEffects(),
      vi.fn(),
    );

    await vi.advanceTimersByTimeAsync(0);
    await alarm.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(job.runs).toEqual([]);
    expect(stop).toHaveBeenCalledOnce();
  });
});
