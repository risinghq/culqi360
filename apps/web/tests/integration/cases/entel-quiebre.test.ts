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
import type { BranchId, CaseId, CaseTypeId } from "~/domain/ids";
import { entelCaseTypes } from "~/server/cases/presets/entel";
import { createCasesRuntime } from "~/server/cases/runtime";

const QUIEBRE = entelCaseTypes({
  carteras: ["CARTERA A"],
  fixedProducts: ["INTERNET 200"],
}).find((each) => each.key === "quiebre");
if (!QUIEBRE) {
  throw new Error("the Entel presets include the quiebre");
}

const LIMA = TEST_FIXTURES.branches.lima.id;
const NORTE = TEST_FIXTURES.branches.norte.id;
const EXECUTIVE = TEST_FIXTURES.users.execOne.id;
// The fixtures have no supervisor. A stage write checks the role it is given,
// and the user only signs the write.
const SUPERVISOR = TEST_FIXTURES.users.superUser.id;
const OPERATION = operationAt(new Date("2026-11-16T15:00:00.000Z"));

// Invented demo values for a quiebre filed for Tienda Norte.
const FILED = {
  zonal: NORTE,
  servicio: "MOVIL",
  tipo_averia: "SIN DATOS",
  numero_problema: "900000001",
  problema_equipo: "NO",
  fecha_activacion: "2026-10-01",
  contacto1: "Ana Demo",
  celular1: "900000002",
  correo1: "ana@example.com",
};

describe("Entel quiebre", () => {
  let ctx: TestDbContext;
  let caseTypeId: CaseTypeId;
  let caseId: CaseId;
  let version: number;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("entel-quiebre");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
    const defined = await runtime().defineCaseType(QUIEBRE, OPERATION);
    if (!defined.ok) {
      throw new Error(`the case type must define: ${defined.error.code}`);
    }
    caseTypeId = defined.value.caseTypeId;
    // An executive in Lima files a quiebre that Tienda Norte must validate.
    const opened = await runtime().open(
      {
        actorUserId: EXECUTIVE,
        actorRole: "executive",
        actorBranchId: LIMA,
        caseTypeKey: QUIEBRE.key,
        ruc: hydrateRuc(TEST_FIXTURES.organizations.lima.ruc),
        values: FILED,
      },
      OPERATION,
    );
    if (!opened.ok) {
      throw new Error(`the case must open: ${opened.error.code}`);
    }
    caseId = opened.value.caseId;
    version = opened.value.version;
  });

  function runtime() {
    return createCasesRuntime({ executor: ctx.db });
  }

  async function queuedFor(branchId: BranchId): Promise<boolean> {
    const waiting = await runtime().waiting({
      caseTypeId,
      role: "supervisor",
      branchId,
    });
    if (!waiting.ok) {
      throw new Error(waiting.error.code ?? "the queue must list");
    }
    return waiting.value.some((each) => each.id === caseId);
  }

  function validateFrom(branchId: BranchId) {
    return runtime().writeStage(
      {
        actorUserId: SUPERVISOR,
        actorRole: "supervisor",
        actorBranchId: branchId,
        caseId,
        expectedVersion: version,
        stageKey: "validacion",
        values: { caso_sf: "SF-0001" },
        status: "ATENDIDO",
      },
      OPERATION,
    );
  }

  it("waits only in the queue of the tienda it names", async () => {
    expect(await queuedFor(NORTE)).toBe(true);
    expect(await queuedFor(LIMA)).toBe(false);
  });

  it("is validated only by the named tienda's supervisor", async () => {
    expect(await validateFrom(LIMA)).toMatchObject({
      ok: false,
      error: { code: "case_stage_not_owned" },
    });
    expect(
      await runtime().read({
        caseId,
        actorUserId: SUPERVISOR,
        role: "supervisor",
        branchId: LIMA,
        viewAll: true,
      }),
    ).toMatchObject({
      ok: true,
      value: { access: { validacion: "other_branch" } },
    });

    expect((await validateFrom(NORTE)).ok).toBe(true);
    expect(await queuedFor(NORTE)).toBe(false);
  });
});
