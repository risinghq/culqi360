import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createSchedule,
  type Schedule,
} from "~/server/platform/schedule/schedule";

import { BENCH_NOW } from "../_shared/constants";
import { createVolumeHost } from "../_shared/volume";

// The workspace alarm reads its schedule after every commit, so each write
// pays for one deadline read per duty.
describe("schedule", () => {
  let schedule: Schedule;

  beforeAll(async () => {
    const volume = await createVolumeHost();
    schedule = createSchedule(volume.app.createDuties(), (duty, error) => {
      throw new Error(`duty ${duty} failed`, { cause: error });
    });
  });

  afterAll(async () => {
    await schedule.stop();
  });

  test("read the next deadline of a busy workspace", async ({ bench: run }) => {
    const result = await run(
      "read the next deadline of a busy workspace",
      async () => {
        await schedule.nextAt(BENCH_NOW);
      },
    ).run();
    expect(result.state).toBe("completed");
  });
});
