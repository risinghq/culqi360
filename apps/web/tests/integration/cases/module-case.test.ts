import { operationAt } from "@tests/support/operation";
import { createTestCasesRuntime } from "@tests/support/runtime/cases";
import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  TEST_FIXTURES,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hydrateRuc } from "~/domain/identity/document";
import type { CaseId } from "~/domain/ids";
import {
  deleteModuleCase,
  openModuleCase,
  writeModuleCase,
} from "~/server/cases/application/module-case";
import type { CaseTypeDefinition } from "~/server/cases/domain/definition";
import {
  createCasesRepo,
  type CasesRepo,
} from "~/server/cases/infrastructure/cases-repo";

// A quote a module owns: its code reserves the price until a date the
// customer agreed, and the sweep lapses it then.
const COTIZACION: CaseTypeDefinition = {
  key: "cotizacion",
  name: "Cotización",
  module: "ventas",
  stages: [
    {
      key: "cotizacion",
      name: "Cotización",
      ownerRole: "executive",
      statuses: ["PENDIENTE", "RESERVADO", "ACEPTADO", "VENCIDO"],
      initialStatus: "PENDIENTE",
      gate: null,
      timeout: { whileStatus: "RESERVADO", moveTo: "VENCIDO" },
    },
  ],
  fields: [],
};

const EXECUTIVE = TEST_FIXTURES.users.execOne.id;
const ORGANIZATION = TEST_FIXTURES.organizations.lima.id;
const BRANCH = TEST_FIXTURES.branches.lima.id;
const OPENED_AT = new Date("2026-11-16T15:00:00.000Z");
const DUE_AT = new Date("2026-11-20T15:00:00.000Z");

describe("module cases", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("module-case");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  async function inTransaction<T>(
    work: (cases: CasesRepo) => Promise<T>,
  ): Promise<T> {
    return ctx.db.transaction().execute((tx) => work(createCasesRepo(tx)));
  }

  async function reserveQuote(): Promise<CaseId> {
    const opened = await inTransaction(async (cases) => {
      await cases.insertCaseType(COTIZACION, OPENED_AT);
      return openModuleCase(cases, {
        caseTypeKey: COTIZACION.key,
        organizationId: ORGANIZATION,
        holderUserId: EXECUTIVE,
        actorUserId: EXECUTIVE,
        write: {
          module: "ventas",
          values: { monto: 1200 },
          statuses: { cotizacion: "RESERVADO" },
          deadlines: { cotizacion: DUE_AT },
        },
        actions: [
          {
            action: "reserved",
            detail: { monto: 1200 },
            actorUserId: EXECUTIVE,
          },
        ],
        at: OPENED_AT,
      });
    });
    if (!opened.ok) {
      throw new Error(`the quote must open: ${opened.error.code}`);
    }
    return opened.value.caseId;
  }

  function stage(caseId: CaseId) {
    return ctx.db
      .selectFrom("case_stage_states")
      .select(["status", "due_at"])
      .where("case_id", "=", caseId)
      .executeTakeFirstOrThrow();
  }

  it("stores the module's actions and keeps its cases off the case screens", async () => {
    const caseId = await reserveQuote();

    expect(await stage(caseId)).toEqual({
      status: "RESERVADO",
      due_at: DUE_AT,
    });
    expect(
      await ctx.db
        .selectFrom("case_events")
        .select(["kind", "action", "detail", "actor_user_id"])
        .where("case_id", "=", caseId)
        .execute(),
    ).toEqual([
      {
        kind: "action",
        action: "reserved",
        detail: { monto: 1200 },
        actor_user_id: EXECUTIVE,
      },
    ]);
    const runtime = createTestCasesRuntime(ctx);
    expect(await runtime.types("executive")).toEqual([]);
    expect(
      await runtime.read({
        caseId,
        actorUserId: EXECUTIVE,
        roleKey: "executive",
        branchId: BRANCH,
        viewAll: true,
        canReassign: true,
      }),
    ).toMatchObject({ ok: false, error: { code: "case_not_found" } });
  });

  it("lapses the stage at the module's date", async () => {
    const caseId = await reserveQuote();
    const runtime = createTestCasesRuntime(ctx);

    expect(await runtime.timeOutDue(new Date(DUE_AT.getTime() - 1))).toBe(0);
    expect(await runtime.timeOutDue(DUE_AT)).toBe(1);
    expect(await stage(caseId)).toEqual({ status: "VENCIDO", due_at: null });
  });

  it("writes against the version it read and refuses a stale one", async () => {
    const caseId = await reserveQuote();
    const accept = (expectedVersion: number) =>
      inTransaction((cases) =>
        writeModuleCase(cases, {
          caseId,
          expectedVersion,
          write: { module: "ventas", statuses: { cotizacion: "ACEPTADO" } },
          actorUserId: EXECUTIVE,
          actions: [{ action: "accepted", actorUserId: EXECUTIVE }],
          at: OPENED_AT,
        }),
      );

    expect(await accept(0)).toMatchObject({ ok: true, value: { version: 1 } });
    expect(await accept(0)).toMatchObject({
      ok: false,
      error: { code: "case_conflict" },
    });
    expect(await stage(caseId)).toEqual({ status: "ACEPTADO", due_at: null });
  });

  it("keeps a deleted case's rows but drops it from reads and the sweep", async () => {
    const caseId = await reserveQuote();

    const deleted = await inTransaction((cases) =>
      deleteModuleCase(cases, {
        caseId,
        expectedVersion: 0,
        module: "ventas",
        actions: [{ action: "deleted", actorUserId: EXECUTIVE }],
        at: OPENED_AT,
      }),
    );

    expect(deleted).toEqual({ ok: true, value: null });
    expect(await inTransaction((cases) => cases.findCase(caseId))).toBeNull();
    expect(await createTestCasesRuntime(ctx).timeOutDue(DUE_AT)).toBe(0);
    expect(await stage(caseId)).toEqual({
      status: "RESERVADO",
      due_at: DUE_AT,
    });
  });

  it("refuses another module's write and a screen opening of a module type", async () => {
    const caseId = await reserveQuote();

    expect(
      await inTransaction((cases) =>
        writeModuleCase(cases, {
          caseId,
          expectedVersion: 0,
          write: { module: "cobranza", statuses: { cotizacion: "ACEPTADO" } },
          actorUserId: EXECUTIVE,
          actions: [],
          at: OPENED_AT,
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "case_not_found" } });
    const runtime = createTestCasesRuntime(ctx);
    expect(
      await runtime.open(
        {
          actorUserId: EXECUTIVE,
          actorRoleKey: "executive",
          actorBranchId: BRANCH,
          caseTypeKey: COTIZACION.key,
          ruc: hydrateRuc(TEST_FIXTURES.organizations.lima.ruc),
          values: {},
        },
        operationAt(OPENED_AT),
      ),
    ).toMatchObject({ ok: false, error: { code: "case_type_not_found" } });
    expect(
      await runtime.defineCaseType(
        { ...COTIZACION, key: "otra" },
        operationAt(OPENED_AT),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "case_type_module_owned" },
    });
  });
});
