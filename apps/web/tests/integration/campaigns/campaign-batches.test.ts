import { operationAt } from "@tests/support/operation";
import {
  cleanupTestDb,
  createIsolatedTestDb,
  insertWorkspace,
  resetTestDb,
  TEST_FIXTURES,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceId, type CampaignId } from "~/domain/ids";
import type { CampaignImportRow } from "~/server/campaigns/domain/import-rows";
import { createCampaignsRuntime } from "~/server/campaigns/runtime";
import { runInWorkspace } from "~/server/platform/database/workspace-scope";

const OTHER_WORKSPACE_ID = WorkspaceId.trust(
  "01974fd5-f261-7a7d-93f5-2f3d0f965003",
);
const EXEC_ONE = TEST_FIXTURES.users.execOne.id;
const EXEC_TWO = TEST_FIXTURES.users.execTwo.id;
const IMPORTED = operationAt(new Date("2026-11-16T15:00:00.000Z"));
const LATER = operationAt(new Date("2026-11-16T18:00:00.000Z"));

function companies(count: number, segment: string): CampaignImportRow[] {
  return Array.from({ length: count }, (_, index) => ({
    line: index + 2,
    ruc: `205${segment === "PYME" ? "0" : "1"}${String(index).padStart(7, "0")}`,
    legalName: `Empresa ${index}`,
    segment,
    facts: { lineas: String(index) },
  }));
}

describe("campaign batches", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("campaign-batches");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  function runtime() {
    return createCampaignsRuntime({ executor: ctx.db });
  }

  async function importRows(rows: CampaignImportRow[]): Promise<CampaignId> {
    const imported = await runtime().import(
      { campaignName: "Entel noviembre", rows },
      IMPORTED,
    );
    if (!imported.ok) {
      throw new Error(`the import must load: ${imported.error.code}`);
    }
    return imported.value.campaignId;
  }

  async function draw(campaignId: CampaignId, actorUserId = EXEC_ONE) {
    const batch = await runtime().draw(
      { actorUserId, campaignId, segment: "PYME" },
      IMPORTED,
    );
    if (!batch.ok) {
      throw new Error(`the draw must succeed: ${batch.error.code}`);
    }
    return batch.value;
  }

  it("hands two executives disjoint batches of 30 and repeats an open batch", async () => {
    const campaignId = await importRows([
      ...companies(45, "PYME"),
      ...companies(5, "CORP"),
    ]);

    const [first, second] = await Promise.all([
      draw(campaignId, EXEC_ONE),
      draw(campaignId, EXEC_TWO),
    ]);
    const firstIds = first.map((record) => record.id);
    const secondIds = second.map((record) => record.id);

    expect(new Set([firstIds.length, secondIds.length])).toEqual(
      new Set([15, 30]),
    );
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    expect(
      [...first, ...second].every((record) => record.segment === "PYME"),
    ).toBe(true);
    expect((await draw(campaignId, EXEC_ONE)).map((r) => r.id)).toEqual(
      firstIds,
    );
    expect(await runtime().availableBySegment(campaignId)).toEqual([
      { segment: "CORP", available: 5 },
    ]);
  });

  it("returns unworked records to the pool and keeps the drawn history", async () => {
    const campaignId = await importRows(companies(3, "PYME"));
    const [worked, ...unworked] = await draw(campaignId);
    if (!worked) {
      throw new Error("the draw must hand out a record");
    }

    expect(
      await runtime().markWorked(
        { actorUserId: EXEC_ONE, recordId: worked.id },
        LATER,
      ),
    ).toEqual({ ok: true, value: undefined });
    expect(
      await runtime().release({ actorUserId: EXEC_ONE, campaignId }, LATER),
    ).toEqual({ ok: true, value: { released: 2 } });

    const redrawn = await draw(campaignId, EXEC_TWO);
    expect(redrawn.map((record) => record.id)).toEqual(
      unworked.map((record) => record.id),
    );
    const history = await ctx.db
      .selectFrom("campaign_assignments")
      .select(["user_id", "released_at"])
      .where(
        "record_id",
        "in",
        unworked.map((record) => record.id),
      )
      .execute();
    expect(history).toHaveLength(4);
    expect(
      history.filter((row) => row.user_id === EXEC_ONE && row.released_at),
    ).toHaveLength(2);
  });

  it("lists the campaign and shows each held record's company", async () => {
    const campaignId = await importRows(companies(2, "PYME"));
    await draw(campaignId);

    expect(await runtime().list()).toEqual([
      { id: campaignId, name: "Entel noviembre", createdAt: expect.any(Date) },
    ]);
    const held = await runtime().held({ actorUserId: EXEC_ONE, campaignId });
    expect(
      held
        .map(({ ruc, legalName }) => ({ ruc, legalName }))
        .toSorted((a, b) => a.ruc.localeCompare(b.ruc)),
    ).toEqual([
      { ruc: "20500000000", legalName: "Empresa 0" },
      { ruc: "20500000001", legalName: "Empresa 1" },
    ]);
    expect(await runtime().held({ actorUserId: EXEC_TWO, campaignId })).toEqual(
      [],
    );
  });

  it("lets only the holder mark a record worked", async () => {
    const campaignId = await importRows(companies(1, "PYME"));
    const [record] = await draw(campaignId);
    if (!record) {
      throw new Error("the draw must hand out a record");
    }

    expect(
      await runtime().markWorked(
        { actorUserId: EXEC_TWO, recordId: record.id },
        LATER,
      ),
    ).toMatchObject({ ok: false, error: { code: "campaign_record_not_held" } });
  });

  it("rewrites facts on reload and keeps holders and the record id", async () => {
    const rows = companies(2, "PYME");
    const campaignId = await importRows(rows);
    const drawn = await draw(campaignId);

    await importRows(rows.map((row) => ({ ...row, facts: { lineas: "99" } })));

    const held = await draw(campaignId);
    expect(held.map((record) => record.id)).toEqual(
      drawn.map((record) => record.id),
    );
    expect(held.map((record) => record.facts)).toEqual([
      { lineas: "99" },
      { lineas: "99" },
    ]);
    expect(
      await ctx.db
        .selectFrom("organizations")
        .select("ruc")
        .where(
          "ruc",
          "in",
          rows.map((row) => String(row.ruc)),
        )
        .execute(),
    ).toHaveLength(2);
  });

  it("hides a campaign from another workspace", async () => {
    const campaignId = await importRows(companies(2, "PYME"));
    await insertWorkspace(ctx.db, { id: OTHER_WORKSPACE_ID, name: "Other" });

    const foreign = await runInWorkspace(OTHER_WORKSPACE_ID, () =>
      runtime().draw(
        { actorUserId: EXEC_ONE, campaignId, segment: null },
        IMPORTED,
      ),
    );

    expect(foreign).toMatchObject({
      ok: false,
      error: { code: "campaign_not_found" },
    });
    expect(
      await runInWorkspace(OTHER_WORKSPACE_ID, () => runtime().list()),
    ).toEqual([]);
    expect(await runtime().availableBySegment(campaignId)).toEqual([
      { segment: "PYME", available: 2 },
    ]);
  });
});
