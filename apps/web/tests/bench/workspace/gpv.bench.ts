import { beforeAll, describe, expect, test } from "vitest";

import { GPV_IMPORT_BATCH_LINES } from "~/contracts/merchant-stats/imports";
import type { GpvSnapshotId, UserId } from "~/domain/ids";
import { closeGpvImport } from "~/server/merchant-stats/snapshot/close";
import { openGpvImport } from "~/server/merchant-stats/snapshot/open";
import { stageGpvLines } from "~/server/merchant-stats/snapshot/stage";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { TableBody } from "~/shared/table";

import { BENCH_NOW } from "../_shared/constants";
import { createBenchHost } from "../_shared/host";

// Every placement the active snapshot holds. Close is linear in placements,
// so a report this size tracks its cost; a 20,000-line report outruns the
// test timeout under CodSpeed's simulation.
const PLACEMENTS = 2_000;

const COLUMNS = [
  "anomes_vta",
  "identificador_tributario",
  "id_merchant",
  "num_serie",
  "producto",
  "fecha_venta",
  "gpv_m0",
  "trx_m0",
  "gpv_m1",
  "trx_m1",
];

const CUT = new Date("2026-11-15T12:00:00.000Z");

function gpvTable(from: number, count: number): TableBody {
  return {
    columns: COLUMNS,
    lines: Array.from({ length: count }, (_, offset) => {
      const index = from + offset;
      return {
        line: index + 2,
        cells: [
          "202609",
          `20${String(index).padStart(9, "0")}`,
          `m-${index}`,
          `SN-${index}`,
          "CULQIFULL",
          "",
          "100",
          "4",
          "250",
          "9",
        ],
      };
    }),
  };
}

// The GPV import writes. The browser stages a report in batches, and each
// batch is one transaction on the workspace's Durable Object, which serves
// nothing else while it runs. Closing compares the whole file with the
// active snapshot and activates it in one transaction.
describe("gpv imports", () => {
  let db: WorkspaceExecutor;
  let uploadedBy: UserId;
  let nextSha = 0;

  async function open(): Promise<GpvSnapshotId> {
    nextSha += 1;
    const opened = await openGpvImport(db, {
      contentSha256: nextSha.toString(16).padStart(64, "0"),
      cutAt: CUT,
      uploadedBy,
      uploadedAt: BENCH_NOW,
    });
    if (opened.kind !== "opened") {
      throw new Error(`open failed: ${opened.kind}`);
    }
    return opened.snapshotId;
  }

  async function stage(snapshotId: GpvSnapshotId, table: TableBody) {
    const staged = await stageGpvLines(db, {
      snapshotId,
      table,
      stagedAt: BENCH_NOW,
    });
    if (!staged.ok) {
      throw new Error(`stage failed: ${staged.error.code}`);
    }
  }

  async function stageReport(snapshotId: GpvSnapshotId): Promise<void> {
    for (let from = 0; from < PLACEMENTS; from += GPV_IMPORT_BATCH_LINES) {
      // eslint-disable-next-line no-await-in-loop
      await stage(snapshotId, gpvTable(from, GPV_IMPORT_BATCH_LINES));
    }
  }

  async function close(snapshotId: GpvSnapshotId): Promise<void> {
    const closed = await closeGpvImport(db, {
      snapshotId,
      closedAt: BENCH_NOW,
    });
    if (!closed.ok || closed.value.state !== "active") {
      throw new Error("close did not activate the snapshot");
    }
  }

  beforeAll(async () => {
    const bench = await createBenchHost();
    db = (await bench.host.stores.workspace(bench.workspaceId)).db;
    uploadedBy = bench.admin.id;

    const active = await open();
    await stageReport(active);
    await close(active);
  });

  test("stage a GPV batch", async ({ bench: run }) => {
    let snapshotId: GpvSnapshotId | undefined;
    let batch = 0;
    const result = await run(
      "stage a GPV batch",
      {
        async beforeEach() {
          snapshotId = await open();
          batch = (batch + 1) % (PLACEMENTS / GPV_IMPORT_BATCH_LINES);
        },
      },
      async () => {
        if (!snapshotId) {
          throw new Error("no staging snapshot");
        }
        await stage(
          snapshotId,
          gpvTable(batch * GPV_IMPORT_BATCH_LINES, GPV_IMPORT_BATCH_LINES),
        );
      },
    ).run();
    expect(result.state).toBe("completed");
  });

  test("close and activate a GPV report", async ({ bench: run }) => {
    let snapshotId: GpvSnapshotId | undefined;
    const result = await run(
      "close and activate a GPV report",
      {
        async beforeEach() {
          snapshotId = await open();
          await stageReport(snapshotId);
        },
      },
      async () => {
        if (!snapshotId) {
          throw new Error("no staged snapshot");
        }
        await close(snapshotId);
      },
      // Each iteration stages a whole report first, so a few samples suffice.
    ).run({ iterations: 5, time: 0, warmup: false });
    expect(result.state).toBe("completed");
  });
});
