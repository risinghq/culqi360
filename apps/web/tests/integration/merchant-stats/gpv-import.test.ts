import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GpvSnapshotId } from "~/domain/ids";
import { parseCalendarMonth } from "~/domain/time/calendar-date";
import { getAttainment } from "~/server/merchant-stats/read/attainment";
import { closeGpvImport } from "~/server/merchant-stats/snapshot/close";
import { openGpvImport } from "~/server/merchant-stats/snapshot/open";
import { stageGpvLines } from "~/server/merchant-stats/snapshot/stage";
import type { TableBody } from "~/shared/table";

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
const AT = new Date("2026-11-16T12:00:00.000Z");

interface Placement {
  ruc: string;
  merchant: string;
  saleMonth?: string;
}

function table(placements: readonly Placement[], firstLine = 2): TableBody {
  return {
    columns: COLUMNS,
    lines: placements.map((placement, index) => ({
      line: firstLine + index,
      cells: [
        placement.saleMonth ?? "202609",
        placement.ruc,
        placement.merchant,
        `SN-${placement.merchant}`,
        "CULQIFULL",
        "",
        "100",
        "4",
        "250",
        "9",
      ],
    })),
  };
}

const LIMA: Placement = { ruc: "20100000001", merchant: "m-lima" };
const NORTE: Placement = { ruc: "20100000002", merchant: "m-norte" };

describe("GPV import", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("gpv-import");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  async function open(sha: string, cutAt = CUT) {
    return openGpvImport(ctx.db, {
      contentSha256: sha.padEnd(64, "0"),
      cutAt,
      uploadedBy: ctx.fixtures.users.backOne.id,
      uploadedAt: AT,
    });
  }

  async function opened(sha: string, cutAt = CUT): Promise<GpvSnapshotId> {
    const result = await open(sha, cutAt);
    if (result.kind !== "opened") {
      throw new Error(`expected an opened import, got ${result.kind}`);
    }
    return result.snapshotId;
  }

  async function stage(snapshotId: GpvSnapshotId, body: TableBody) {
    return stageGpvLines(ctx.db, { snapshotId, table: body, stagedAt: AT });
  }

  async function close(snapshotId: GpvSnapshotId) {
    return closeGpvImport(ctx.db, { snapshotId, closedAt: AT });
  }

  async function importFile(
    sha: string,
    placements: readonly Placement[],
    cutAt = CUT,
  ): Promise<GpvSnapshotId> {
    const snapshotId = await opened(sha, cutAt);
    expect((await stage(snapshotId, table(placements))).ok).toBe(true);
    return snapshotId;
  }

  async function issueTypes(snapshotId: GpvSnapshotId): Promise<string[]> {
    const issues = await ctx.db
      .selectFrom("gpv_snapshot_issues")
      .select("issue_type")
      .where("snapshot_id", "=", snapshotId)
      .orderBy("issue_type")
      .execute();
    return issues.map((issue) => issue.issue_type);
  }

  it("activates a file staged in batches once it closes", async () => {
    const snapshotId = await opened("a1");
    await stage(snapshotId, table([LIMA]));
    await stage(snapshotId, table([NORTE], 3));

    expect(await close(snapshotId)).toEqual({
      ok: true,
      value: { state: "active" },
    });
    const observations = await ctx.db
      .selectFrom("gpv_snapshot_observations")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("snapshot_id", "=", snapshotId)
      .executeTakeFirstOrThrow();
    expect(observations.count).toBe(4);
  });

  it("returns the snapshot of a file already imported", async () => {
    const snapshotId = await importFile("a1", [LIMA]);
    await close(snapshotId);

    expect(await open("a1")).toEqual({ kind: "duplicate", snapshotId });
  });

  it("refuses a cut older than the active snapshot", async () => {
    await close(await importFile("a1", [LIMA]));

    expect(await open("b2", new Date("2026-10-15T12:00:00.000Z"))).toEqual({
      kind: "stale",
      activeCutAt: CUT,
    });
  });

  it("drops an import still staging when the next one opens", async () => {
    const abandoned = await importFile("a1", [LIMA]);
    await opened("b2");

    const staged = await stage(abandoned, table([NORTE]));
    expect(staged.ok ? null : staged.error.code).toBe("gpv_snapshot_not_found");
  });

  it("holds a repeated placement for review", async () => {
    const snapshotId = await opened("a1");
    await stage(snapshotId, table([LIMA]));
    await stage(snapshotId, table([LIMA], 3));

    expect(await close(snapshotId)).toEqual({
      ok: true,
      value: { state: "needs_review" },
    });
    expect(await issueTypes(snapshotId)).toEqual(["row_rejected"]);
  });

  it("holds a placement the new file leaves out for review", async () => {
    await close(await importFile("a1", [LIMA, NORTE]));
    const later = new Date("2026-12-15T12:00:00.000Z");
    const snapshotId = await importFile("b2", [LIMA], later);

    expect(await close(snapshotId)).toEqual({
      ok: true,
      value: { state: "needs_review" },
    });
    expect(await issueTypes(snapshotId)).toEqual(["placement_missing"]);
  });

  it("holds a placement whose sale month changed for review", async () => {
    await close(await importFile("a1", [LIMA]));
    const later = new Date("2026-12-15T12:00:00.000Z");
    const snapshotId = await importFile(
      "b2",
      [{ ...LIMA, saleMonth: "202608" }],
      later,
    );

    expect(await close(snapshotId)).toEqual({
      ok: true,
      value: { state: "needs_review" },
    });
    expect(await issueTypes(snapshotId)).toEqual(["sale_month_changed"]);
  });

  it("links only the sellers of the viewer's branch to their member page", async () => {
    const snapshotId = await importFile("a1", [LIMA, NORTE]);
    await close(snapshotId);
    const { users, organizations } = ctx.fixtures;
    await ctx.db
      .insertInto("merchant_month_credits")
      .values(
        [
          { organization: organizations.lima, seller: users.execOne },
          { organization: organizations.norte, seller: users.execTwo },
        ].map(({ organization, seller }) => ({
          ruc: organization.ruc,
          month: "2026-09-01",
          organization_id: organization.id,
          seller_user_id: seller.id,
          branch_id: seller.branchId,
          first_snapshot_id: snapshotId,
          credited_at: AT,
        })),
      )
      .execute();
    const month = parseCalendarMonth("2026-09");
    if (!month) {
      throw new Error("bad month");
    }

    const { sellers } = await getAttainment(
      ctx.db,
      {},
      month,
      users.execOne.branchId,
    );

    expect(
      Object.fromEntries(sellers.map((seller) => [seller.id, seller.memberId])),
    ).toEqual({
      [users.execOne.id]: users.execOne.id,
      [users.execTwo.id]: null,
    });
  });

  it("refuses lines for a snapshot that has closed", async () => {
    const snapshotId = await importFile("a1", [LIMA]);
    await close(snapshotId);

    const staged = await stage(snapshotId, table([NORTE]));
    expect(staged.ok ? null : staged.error.code).toBe(
      "gpv_snapshot_not_staging",
    );
  });
});
