import { describe, expect, it, vi } from "vitest";

import { CommitEffects } from "~/server/platform/database/commit-effects";
import {
  type AlarmStorage,
  createObjectAlarm,
} from "~/server/platform/schedule/object-alarm";
import { createSchedule, type Duty } from "~/server/platform/schedule/schedule";

const T0 = new Date("2026-11-20T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

function memoryAlarm() {
  const state = { alarm: null as number | null, writes: 0 };
  const storage: AlarmStorage = {
    getAlarm: () => Promise.resolve(state.alarm),
    setAlarm: (time) => {
      state.alarm = time;
      state.writes += 1;
      return Promise.resolve();
    },
    deleteAlarm: () => {
      state.alarm = null;
      state.writes += 1;
      return Promise.resolve();
    },
  };
  return { state, storage };
}

function duty(next: Date | null, name = "duty") {
  const state = { next, runs: [] as Date[] };
  const value: Duty = {
    name,
    nextAt: () => Promise.resolve(state.next),
    run: (context) => {
      state.runs.push(context.operationAt);
      state.next = null;
      return Promise.resolve();
    },
  };
  return { duty: value, state };
}

function commit(effects: CommitEffects) {
  effects.begin();
  effects.commit();
}

describe("object alarm", () => {
  it("arms at the earliest deadline once, then skips invocations that wrote nothing", async () => {
    const work = duty(at(5_000));
    const effects = new CommitEffects();
    const { state, storage } = memoryAlarm();
    const alarm = createObjectAlarm(
      createSchedule([work.duty], vi.fn()),
      effects,
      storage,
    );

    await alarm.settle(T0);
    await alarm.settle(T0);

    expect(state.alarm).toBe(at(5_000).getTime());
    expect(state.writes).toBe(1);
  });

  it("moves the alarm when a commit brings a deadline closer", async () => {
    const work = duty(at(5_000));
    const effects = new CommitEffects();
    const { state, storage } = memoryAlarm();
    const alarm = createObjectAlarm(
      createSchedule([work.duty], vi.fn()),
      effects,
      storage,
    );
    await alarm.settle(T0);

    work.state.next = at(1_000);
    commit(effects);
    await alarm.settle(T0);

    expect(state.alarm).toBe(at(1_000).getTime());
  });

  it("clears the alarm when no duty has work", async () => {
    const work = duty(at(5_000));
    const effects = new CommitEffects();
    const { state, storage } = memoryAlarm();
    const alarm = createObjectAlarm(
      createSchedule([work.duty], vi.fn()),
      effects,
      storage,
    );
    await alarm.settle(T0);

    work.state.next = null;
    commit(effects);
    await alarm.settle(T0);

    expect(state.alarm).toBeNull();
  });

  it("runs the due duties when it fires and re-arms for what is left", async () => {
    const due = duty(T0, "due");
    const later = duty(at(60_000), "later");
    const effects = new CommitEffects();
    const { state, storage } = memoryAlarm();
    const alarm = createObjectAlarm(
      createSchedule([due.duty, later.duty], vi.fn()),
      effects,
      storage,
    );

    await alarm.fire(T0);

    expect(due.state.runs).toEqual([T0]);
    expect(later.state.runs).toEqual([]);
    expect(state.alarm).toBe(at(60_000).getTime());
  });

  it("lets the last arm win when invocations interleave", async () => {
    // The first read sees 5s and stalls until released; later reads see 1s.
    const gate = Promise.withResolvers<void>();
    let next = at(5_000);
    let calls = 0;
    const gated: Duty = {
      name: "gated",
      async nextAt() {
        calls += 1;
        const seen = next;
        if (calls === 1) {
          await gate.promise;
        }
        return seen;
      },
      run: () => Promise.resolve(),
    };
    const effects = new CommitEffects();
    const { state, storage } = memoryAlarm();
    const alarm = createObjectAlarm(
      createSchedule([gated], vi.fn()),
      effects,
      storage,
    );

    const stale = alarm.settle(T0);
    next = at(1_000);
    commit(effects);
    const fresh = alarm.settle(T0);
    // A macrotask later, so an unserialized fresh arm would finish first.
    setTimeout(gate.resolve, 0);
    await Promise.all([stale, fresh]);

    expect(state.alarm).toBe(at(1_000).getTime());
  });
});
