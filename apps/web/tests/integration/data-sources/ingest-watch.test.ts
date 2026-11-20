import { operationAt } from "@tests/support/operation";
import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { IngestJob } from "~/contracts/data-sources/ingest";
import { external, type DomainError } from "~/domain/errors";
import { createIngestWatch } from "~/server/data-source-uploads/ingest-watch";
import { Err, Ok, type Result } from "~/shared/result";

const T0 = new Date("2026-11-20T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

type Read = Result<IngestJob, DomainError>;

function job(outcome: IngestJob["outcome"]): Read {
  const read: IngestJob = {
    job_id: "job-1",
    source_key: "source",
    snapshot_label: "label",
    step: outcome === "running" ? "staging" : "complete",
    outcome,
    snapshot_id: null,
    total_rows: 10,
    accepted_rows: 10,
    invalid_doc_rows: 0,
    gate: null,
    error: null,
    created_at: 0,
    updated_at: 0,
  };
  return Ok(read);
}

describe("ingest watch", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("ingest-watch");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  // Each engine read takes the next answer; an empty list fails the test.
  function watchWith(reads: Read[]) {
    const published: string[] = [];
    const watch = createIngestWatch({
      db: ctx.db,
      realtime: {
        publish: (_db, _channel, payload) => {
          published.push(payload);
        },
      },
      getJob: () => {
        const next = reads.shift();
        if (!next) throw new Error("unexpected engine read");
        return Promise.resolve(next);
      },
    });
    return { watch, published };
  }

  it("polls a tracked job until it settles, then stops", async () => {
    const { watch, published } = watchWith([job("running"), job("succeeded")]);
    await watch.track("job-1", T0);
    await watch.track("job-1", at(500));
    expect(await watch.duty.nextAt()).toEqual(T0);

    await watch.duty.run(operationAt(T0));
    expect(await watch.duty.nextAt()).toEqual(at(2_000));

    await watch.duty.run(operationAt(at(2_000)));
    expect(await watch.duty.nextAt()).toBeNull();
    expect(published.map((p) => JSON.parse(p).state)).toEqual([
      "processing",
      "done",
    ]);
  });

  it("keeps watching after a failed engine read", async () => {
    const { watch, published } = watchWith([Err(external("engine down"))]);
    await watch.track("job-1", T0);

    await watch.duty.run(operationAt(T0));

    expect(await watch.duty.nextAt()).toEqual(at(2_000));
    expect(published).toEqual([]);
  });

  it("drops a watch past its deadline without reading the engine", async () => {
    const { watch, published } = watchWith([]);
    await watch.track("job-1", T0);

    await watch.duty.run(operationAt(at(30 * 60_000)));

    expect(await watch.duty.nextAt()).toBeNull();
    expect(published).toEqual([]);
  });
});
