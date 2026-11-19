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

import { FIJA } from "./fija";

const EXECUTIVE = TEST_FIXTURES.users.execOne.id;
const BACK_OFFICE = TEST_FIXTURES.users.backOne.id;
const RUC = hydrateRuc(TEST_FIXTURES.organizations.lima.ruc);
const BRANCH = TEST_FIXTURES.branches.lima.id;
const OPERATION = operationAt(new Date("2026-11-16T15:00:00.000Z"));

describe("case lifecycle", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("case-lifecycle");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  function runtime() {
    return createTestCasesRuntime(ctx);
  }

  async function openFija() {
    const defined = await runtime().defineCaseType(FIJA, OPERATION);
    expect(defined.ok).toBe(true);
    const opened = await runtime().open(
      {
        actorUserId: EXECUTIVE,
        actorRoleKey: "executive",
        actorBranchId: BRANCH,
        caseTypeKey: FIJA.key,
        ruc: RUC,
        values: { plan: "FIBRA 300" },
      },
      OPERATION,
    );
    if (!opened.ok) {
      throw new Error(`the case must open: ${opened.error.code}`);
    }
    return opened.value;
  }

  function stageStates(caseId: CaseId) {
    return ctx.db
      .selectFrom("case_stage_states")
      .select(["stage_key", "status", "updated_by"])
      .where("case_id", "=", caseId)
      .orderBy("stage_key")
      .execute();
  }

  it("files a case for a RUC the workspace has not seen and adds its company", async () => {
    expect((await runtime().defineCaseType(FIJA, OPERATION)).ok).toBe(true);

    const opened = await runtime().open(
      {
        actorUserId: EXECUTIVE,
        actorRoleKey: "executive",
        actorBranchId: BRANCH,
        caseTypeKey: FIJA.key,
        ruc: hydrateRuc("20999999991"),
        values: { plan: "FIBRA 300" },
      },
      OPERATION,
    );
    if (!opened.ok) {
      throw new Error(`the case must open: ${opened.error.code}`);
    }

    const company = await ctx.db
      .selectFrom("cases")
      .innerJoin("organizations", "organizations.id", "cases.organization_id")
      .select("organizations.ruc")
      .where("cases.id", "=", opened.value.caseId)
      .executeTakeFirstOrThrow();
    expect(company.ruc).toBe("20999999991");
  });

  it("carries a case from filing to the back office through the database", async () => {
    const opened = await openFija();

    const installed = await runtime().writeStage(
      {
        actorUserId: BACK_OFFICE,
        actorRoleKey: "back_office",
        actorBranchId: BRANCH,
        caseId: opened.caseId,
        expectedVersion: opened.version,
        stageKey: "back",
        values: { fecha_instalacion: "2026-11-20" },
        status: "INSTALADO",
      },
      OPERATION,
    );

    expect(installed).toMatchObject({ ok: true, value: { version: 1 } });
    expect(
      await ctx.db
        .selectFrom("cases")
        .select(["field_values", "version", "holder_user_id"])
        .where("id", "=", opened.caseId)
        .executeTakeFirstOrThrow(),
    ).toEqual({
      field_values: { plan: "FIBRA 300", fecha_instalacion: "2026-11-20" },
      version: 1,
      holder_user_id: EXECUTIVE,
    });
    expect(await stageStates(opened.caseId)).toEqual([
      { stage_key: "back", status: "INSTALADO", updated_by: BACK_OFFICE },
      { stage_key: "registro", status: "REGISTRADO", updated_by: EXECUTIVE },
    ]);
  });

  it("refuses a write made against a version that is no longer current", async () => {
    const opened = await openFija();
    const edit = {
      actorUserId: EXECUTIVE,
      actorRoleKey: "executive",
      actorBranchId: BRANCH,
      caseId: opened.caseId,
      expectedVersion: opened.version,
      stageKey: "registro",
    };
    expect(
      (
        await runtime().writeStage(
          { ...edit, values: { plan: "FIBRA 600" } },
          OPERATION,
        )
      ).ok,
    ).toBe(true);

    const stale = await runtime().writeStage(
      { ...edit, values: { plan: "FIBRA 300" } },
      OPERATION,
    );

    expect(stale).toMatchObject({
      ok: false,
      error: { code: "case_conflict" },
    });
    expect(
      await ctx.db
        .selectFrom("cases")
        .select("field_values")
        .where("id", "=", opened.caseId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ field_values: { plan: "FIBRA 600" } });
  });

  it("refuses a second case type with the same key in one workspace", async () => {
    await openFija();

    expect(await runtime().defineCaseType(FIJA, OPERATION)).toMatchObject({
      ok: false,
      error: { code: "case_type_exists" },
    });
  });
});
