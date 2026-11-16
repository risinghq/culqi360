import { operationAt } from "@tests/support/operation";
import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  TEST_FIXTURES,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hydrateRuc } from "~/domain/identity/document";
import { WorkspaceId, type CaseTypeId } from "~/domain/ids";
import { createCasesRuntime } from "~/server/cases/runtime";
import {
  runAsPlatform,
  runInWorkspace,
} from "~/server/platform/database/workspace-scope";

import { FIJA } from "./fija";

const OTHER_WORKSPACE_ID = WorkspaceId.trust(
  "01974fd5-f261-7a7d-93f5-2f3d0f965003",
);
const EXEC_ONE = TEST_FIXTURES.users.execOne.id;
const EXEC_TWO = TEST_FIXTURES.users.execTwo.id;
const BACK_OFFICE = TEST_FIXTURES.users.backOne.id;
const BRANCH = TEST_FIXTURES.branches.lima.id;
const OPERATION = operationAt(new Date("2026-11-16T15:00:00.000Z"));

describe("case reads", () => {
  let ctx: TestDbContext;
  let caseTypeId: CaseTypeId;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("case-reads");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
    const defined = await runtime().defineCaseType(FIJA, OPERATION);
    if (!defined.ok) {
      throw new Error(`the case type must define: ${defined.error.code}`);
    }
    const [fija] = await runtime().types("executive");
    if (!fija) {
      throw new Error("the case type must list");
    }
    caseTypeId = fija.id;
  });

  function runtime() {
    return createCasesRuntime({ executor: ctx.db });
  }

  async function fileAs(
    actorUserId: typeof EXEC_ONE,
    ruc: string = TEST_FIXTURES.organizations.lima.ruc,
  ) {
    const opened = await runtime().open(
      {
        actorUserId,
        actorRole: "executive",
        actorBranchId: BRANCH,
        caseTypeKey: FIJA.key,
        ruc: hydrateRuc(ruc),
        values: { plan: "FIBRA 300" },
      },
      OPERATION,
    );
    if (!opened.ok) {
      throw new Error(`the case must open: ${opened.error.code}`);
    }
    return opened.value;
  }

  it("tells each role whether it files cases or works a queue", async () => {
    expect(await runtime().types("executive")).toMatchObject([
      { definition: { key: FIJA.key }, canOpen: true, hasQueue: false },
    ]);
    expect(await runtime().types("back_office")).toMatchObject([
      { definition: { key: FIJA.key }, canOpen: false, hasQueue: true },
    ]);
  });

  it("lists an executive's own cases unless the role sees every case", async () => {
    const own = await fileAs(EXEC_ONE);
    const other = await fileAs(EXEC_TWO, TEST_FIXTURES.organizations.norte.ruc);

    const mine = await runtime().list({
      caseTypeId,
      actorUserId: EXEC_ONE,
      viewAll: false,
    });
    const every = await runtime().list({
      caseTypeId,
      actorUserId: EXEC_ONE,
      viewAll: true,
    });

    expect(mine.map((each) => each.id)).toEqual([own.caseId]);
    expect(every.map((each) => each.id).toSorted()).toEqual(
      [own.caseId, other.caseId].toSorted(),
    );
  });

  it("queues a filed case for the back office until it is installed", async () => {
    const opened = await fileAs(EXEC_ONE);
    const queue = () =>
      runtime().waiting({ caseTypeId, role: "back_office", branchId: BRANCH });

    expect(await queue()).toMatchObject({
      ok: true,
      value: [{ id: opened.caseId, ruc: TEST_FIXTURES.organizations.lima.ruc }],
    });
    expect(
      await runtime().waiting({
        caseTypeId,
        role: "executive",
        branchId: BRANCH,
      }),
    ).toEqual({ ok: true, value: [] });

    const installed = await runtime().writeStage(
      {
        actorUserId: BACK_OFFICE,
        actorRole: "back_office",
        actorBranchId: BRANCH,
        caseId: opened.caseId,
        expectedVersion: opened.version,
        stageKey: "back",
        values: { fecha_instalacion: "2026-11-20" },
        status: "INSTALADO",
      },
      OPERATION,
    );
    expect(installed.ok).toBe(true);

    expect(await queue()).toEqual({ ok: true, value: [] });
  });

  it("shows a case to its owner and its queue, and hides it from another executive", async () => {
    const opened = await fileAs(EXEC_ONE);
    const read = (
      actorUserId: typeof EXEC_ONE,
      role: "executive" | "back_office",
    ) =>
      runtime().read({
        caseId: opened.caseId,
        actorUserId,
        role,
        branchId: BRANCH,
        viewAll: false,
      });

    expect(await read(EXEC_ONE, "executive")).toMatchObject({
      ok: true,
      value: { access: { registro: "writable", back: "not_owned" } },
    });
    expect(await read(BACK_OFFICE, "back_office")).toMatchObject({
      ok: true,
      value: { access: { registro: "not_owned", back: "writable" } },
    });
    expect(await read(EXEC_TWO, "executive")).toMatchObject({
      ok: false,
      error: { code: "case_not_found" },
    });
  });

  it("lets a role that sees every case read another executive's case without writing it", async () => {
    const opened = await fileAs(EXEC_ONE);

    expect(
      await runtime().read({
        caseId: opened.caseId,
        actorUserId: EXEC_TWO,
        role: "executive",
        branchId: BRANCH,
        viewAll: true,
      }),
    ).toMatchObject({
      ok: true,
      value: { access: { registro: "not_owned", back: "not_owned" } },
    });
  });

  it("keeps case types and cases inside their workspace", async () => {
    const opened = await fileAs(EXEC_ONE);
    await runAsPlatform(() =>
      ctx.db
        .insertInto("workspaces")
        .values({
          id: OTHER_WORKSPACE_ID,
          name: "Other",
          created_at: new Date(),
        })
        .execute(),
    );

    const seen = await runInWorkspace(OTHER_WORKSPACE_ID, async () => ({
      types: await runtime().types("executive"),
      cases: await runtime().list({
        caseTypeId,
        actorUserId: EXEC_ONE,
        viewAll: true,
      }),
      read: await runtime().read({
        caseId: opened.caseId,
        actorUserId: EXEC_ONE,
        role: "executive",
        branchId: BRANCH,
        viewAll: true,
      }),
    }));

    expect(seen).toMatchObject({
      types: [],
      cases: [],
      read: { ok: false, error: { code: "case_not_found" } },
    });
  });
});
