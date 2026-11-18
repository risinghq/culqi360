import { expectErr, expectOk } from "@tests/support/_core/assertions";
import { operationAt } from "@tests/support/operation";
import { createTestCasesRuntime } from "@tests/support/runtime/cases";
import {
  cleanupTestDb,
  createIsolatedTestDb,
  insertWorkspace,
  resetTestDb,
  TEST_FIXTURES,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { hydrateRuc } from "~/domain/identity/document";
import {
  ActivityOutcomeId,
  WorkspaceId,
  type CaseTypeId,
  type UserId,
} from "~/domain/ids";
import {
  parseCalendarDate,
  parseCalendarMonth,
  type CalendarDate,
  type CalendarMonth,
} from "~/domain/time/calendar-date";
import type { CaseTypeDefinition } from "~/server/cases/domain/definition";
import { createFilesRuntime } from "~/server/files/runtime";
import { runInWorkspace } from "~/server/platform/database/workspace-scope";
import type { ReportReach } from "~/server/reports/infrastructure/reports-repo";
import { createReportsRuntime } from "~/server/reports/runtime";

import { FIJA } from "../cases/fija";

function day(value: string): CalendarDate {
  const parsed = parseCalendarDate(value);
  if (parsed === null) {
    throw new Error(`not a calendar date: ${value}`);
  }
  return parsed;
}

function month(value: string): CalendarMonth {
  const parsed = parseCalendarMonth(value);
  if (parsed === null) {
    throw new Error(`not a calendar month: ${value}`);
  }
  return parsed;
}

function startedAt(rows: { startedAt: Date }[]) {
  return rows.map((row) => row.startedAt.toISOString());
}

const OTHER_WORKSPACE_ID = WorkspaceId.trust(
  "01974fd5-f261-7a7d-93f5-2f3d0f965004",
);
const { execOne, execTwo, backOne } = TEST_FIXTURES.users;
const LIMA = TEST_FIXTURES.organizations.lima;
const NORTE = TEST_FIXTURES.organizations.norte;
const NOVEMBER = month("2026-11");
const MID_NOVEMBER = operationAt(new Date("2026-11-16T15:00:00.000Z"));
// 23:00 on 31 October in Lima, already November in UTC.
const LATE_OCTOBER = operationAt(new Date("2026-11-01T04:00:00.000Z"));
const ALL: ReportReach = { kind: "all" };

// FIJA with an amount to sum.
const FIJA_MONTO: CaseTypeDefinition = {
  ...FIJA,
  fields: [
    ...FIJA.fields,
    {
      key: "monto",
      stageKey: "registro",
      label: "Monto",
      kind: "number",
      choices: null,
      required: false,
    },
  ],
};

describe("reports", () => {
  let ctx: TestDbContext;
  let caseTypeId: CaseTypeId;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("reports");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
    expectOk(await cases().defineCaseType(FIJA_MONTO, MID_NOVEMBER));
    const [type] = await cases().types("executive");
    if (!type) {
      throw new Error("the case type must list");
    }
    caseTypeId = type.id;
  });

  function cases() {
    return createTestCasesRuntime(ctx);
  }

  function files() {
    return createFilesRuntime(
      { db: ctx.db, logger: { info() {}, error() {} } },
      { storageRoot: ctx.storageRoot },
    );
  }

  function reports() {
    return createReportsRuntime({
      executor: ctx.db,
      files: files(),
      cases: cases(),
    });
  }

  async function file(
    holder: { id: UserId; branchId: (typeof execOne)["branchId"] },
    ruc: string,
    monto: number | null,
    at = MID_NOVEMBER,
  ) {
    const opened = await cases().open(
      {
        actorUserId: holder.id,
        actorRoleKey: "executive",
        actorBranchId: holder.branchId,
        caseTypeKey: FIJA_MONTO.key,
        ruc: hydrateRuc(ruc),
        values:
          monto === null ? { plan: "FIBRA 300" } : { plan: "FIBRA 300", monto },
      },
      at,
    );
    return expectOk(opened);
  }

  function production(reach: ReportReach, stageKey = "back") {
    return reports().production({
      caseTypeId,
      stageKey,
      sumFieldKey: "monto",
      month: NOVEMBER,
      reach,
    });
  }

  async function holders(reach: ReportReach) {
    return expectOk(await production(reach)).rows.map(
      (row) => row.holderUserId,
    );
  }

  async function outcomeId(label: string) {
    const found = (await reports().outcomes()).find(
      (each) => each.label === label,
    );
    if (!found) {
      throw new Error(`outcome missing: ${label}`);
    }
    return ActivityOutcomeId.trust(found.id);
  }

  async function logCall(
    user: { id: UserId; branchId: (typeof execOne)["branchId"] },
    at: string,
    outcome: ActivityOutcomeId | null,
  ) {
    await ctx.db
      .insertInto("activities")
      .values({
        channel: "call",
        user_id: user.id,
        branch_id: user.branchId,
        organization_id: LIMA.id,
        source: "manual",
        started_at: new Date(at),
        duration_seconds: 75,
        outcome_id: outcome,
      })
      .execute();
  }

  function activities(
    reach: ReportReach,
    overrides: Partial<Parameters<ReturnType<typeof reports>["activities"]>[0]>,
  ) {
    return reports().activities({
      from: day("2026-11-01"),
      to: day("2026-11-30"),
      reach,
      userId: null,
      channel: null,
      outcomeId: null,
      ...overrides,
    });
  }

  it("counts the month's cases by holder and stage status, with the sum", async () => {
    const installed = await file(execOne, LIMA.ruc, 100);
    await file(execOne, NORTE.ruc, 50.5);
    await file(execTwo, LIMA.ruc, null);
    await file(execTwo, NORTE.ruc, 999, LATE_OCTOBER);
    expectOk(
      await cases().writeStage(
        {
          actorUserId: backOne.id,
          actorRoleKey: "back_office",
          actorBranchId: backOne.branchId,
          caseId: installed.caseId,
          expectedVersion: installed.version,
          stageKey: "back",
          values: { fecha_instalacion: "2026-11-20" },
          status: "INSTALADO",
        },
        MID_NOVEMBER,
      ),
    );

    const report = expectOk(await production(ALL));

    expect(report.statuses.map((each) => each.label)).toEqual([
      "PENDIENTE",
      "INSTALADO",
    ]);
    expect(report.sumLabel).toBe("Monto");
    expect(
      report.rows.map(({ holderUserId, counts, total, sum }) => ({
        holderUserId,
        counts,
        total,
        sum,
      })),
    ).toEqual([
      { holderUserId: execOne.id, counts: [1, 1], total: 2, sum: 150.5 },
      { holderUserId: execTwo.id, counts: [1, 0], total: 1, sum: 0 },
    ]);
    expect(report.totals).toEqual({ counts: [2, 1], total: 3, sum: 150.5 });
  });

  it("shows own, branch and workspace rows by reach", async () => {
    await file(execOne, LIMA.ruc, null);
    await file(execTwo, NORTE.ruc, null);

    expect(await holders({ kind: "own", userId: execTwo.id })).toEqual([
      execTwo.id,
    ]);
    expect(
      await holders({ kind: "branch", branchId: execOne.branchId }),
    ).toEqual([execOne.id]);
    expect((await holders(ALL)).toSorted()).toEqual(
      [execOne.id, execTwo.id].toSorted(),
    );
    expect(
      (await reports().users({ kind: "branch", branchId: execOne.branchId }))
        .map((user) => user.id)
        .toSorted(),
    ).toEqual([execOne.id, backOne.id].toSorted());
  });

  it("refuses a stage or sum field the case type does not define", async () => {
    expect(expectErr(await production(ALL, "nope")).code).toBe(
      "report_stage_not_found",
    );
    const bySum = await reports().production({
      caseTypeId,
      stageKey: "back",
      sumFieldKey: "plan",
      month: NOVEMBER,
      reach: ALL,
    });
    expect(expectErr(bySum).code).toBe("report_sum_field_invalid");
  });

  it("filters activity by reach, user and outcome within the range", async () => {
    const sold = await outcomeId("Venta cerrada");
    await logCall(execOne, "2026-11-10T15:00:00.000Z", sold);
    await logCall(execTwo, "2026-11-12T15:00:00.000Z", null);
    // 23:30 on 30 November in Lima: inside a range that ends on the 30th.
    await logCall(execOne, "2026-12-01T04:30:00.000Z", null);
    await logCall(execOne, "2026-12-01T05:30:00.000Z", null);

    expect(startedAt(expectOk(await activities(ALL, {})))).toEqual([
      "2026-12-01T04:30:00.000Z",
      "2026-11-12T15:00:00.000Z",
      "2026-11-10T15:00:00.000Z",
    ]);
    expect(
      startedAt(
        expectOk(
          await activities({ kind: "branch", branchId: execTwo.branchId }, {}),
        ),
      ),
    ).toEqual(["2026-11-12T15:00:00.000Z"]);
    expect(expectOk(await activities(ALL, { outcomeId: sold }))).toEqual([
      expect.objectContaining({
        outcomeLabel: "Venta cerrada",
        ruc: LIMA.ruc,
        durationSeconds: 75,
      }),
    ]);
    expect(
      expectOk(
        await activities(
          { kind: "own", userId: execOne.id },
          { userId: execTwo.id },
        ),
      ),
    ).toEqual([]);
  });

  it("refuses a reversed range or one longer than a year", async () => {
    const reversed = await activities(ALL, {
      from: day("2026-11-30"),
      to: day("2026-11-01"),
    });
    expect(expectErr(reversed).code).toBe("report_range_invalid");
    const tooLong = await activities(ALL, {
      from: day("2025-11-01"),
      to: day("2026-11-02"),
    });
    expect(expectErr(tooLong).code).toBe("report_range_invalid");
  });

  it("exports every activity row in the range as a sheet", async () => {
    await logCall(execOne, "2026-11-10T15:00:00.000Z", null);
    await logCall(execTwo, "2026-11-12T15:00:00.000Z", null);

    const exported = expectOk(
      await reports().exportActivities(
        {
          actor: { userId: execOne.id },
          operationAt: MID_NOVEMBER.operationAt,
        },
        {
          from: day("2026-11-01"),
          to: day("2026-11-30"),
          reach: ALL,
          userId: null,
          channel: "call",
          outcomeId: null,
        },
      ),
    );
    const download = expectOk(
      await files().download(exported.token, MID_NOVEMBER),
    );
    const sheet = XLSX.read(download.body).Sheets.Actividad;
    if (!sheet) {
      throw new Error("the export must have an Actividad sheet");
    }
    expect(
      XLSX.utils
        .sheet_to_json<Record<string, string>>(sheet, { raw: false })
        .map((row) => [row.Fecha, row.Canal, row.RUC]),
    ).toEqual([
      ["12/11/2026 10:00", "Llamada", LIMA.ruc],
      ["10/11/2026 10:00", "Llamada", LIMA.ruc],
    ]);
  });

  it("keeps another workspace's cases and activity out of its reports", async () => {
    await file(execOne, LIMA.ruc, 100);
    await logCall(execOne, "2026-11-10T15:00:00.000Z", null);
    await insertWorkspace(ctx.db, { id: OTHER_WORKSPACE_ID, name: "Other" });

    await runInWorkspace(OTHER_WORKSPACE_ID, async () => {
      expect(await reports().caseTypes()).toEqual([]);
      expect(expectErr(await production(ALL)).code).toBe("case_type_not_found");
      expect(expectOk(await activities(ALL, {}))).toEqual([]);
    });
  });
});
