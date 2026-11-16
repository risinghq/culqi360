import { operationAt } from "@tests/support/operation";
import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  TEST_FIXTURES,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Role } from "~/domain/auth/access/rbac";
import type { CaseId, CaseTypeId, UserId } from "~/domain/ids";
import { entelCaseTypes } from "~/server/cases/presets/entel";
import { createCasesRuntime } from "~/server/cases/runtime";

const [MOVIL] = entelCaseTypes({
  zonales: ["TIENDA CENTRO", "TIENDA NORTE"],
  carteras: ["CARTERA A"],
  fixedProducts: ["INTERNET 200"],
});
if (!MOVIL) {
  throw new Error("the Entel presets start with the mobile order");
}

const EXECUTIVE = TEST_FIXTURES.users.execOne.id;
const BACK_OFFICE = TEST_FIXTURES.users.backOne.id;
// The fixtures have no supervisor or sales manager. A stage write checks the
// role it is given, and the user only signs the write.
const STAFF = TEST_FIXTURES.users.superUser.id;
const OPERATION = operationAt(new Date("2026-11-16T15:00:00.000Z"));

const FILED = {
  zonal: "TIENDA CENTRO",
  q_lineas: 5,
  cargo_fijo: 120,
  modalidad: "PORTABILIDAD",
  contacto: "Contacto Demo",
  telefono1: "900000001",
  nivel_negociacion: "75",
  fecha_estimada: "2026-11-30",
  tipo_producto: "M4",
  etapa: "F3-NEGOCIACION",
};

describe("Entel mobile order", () => {
  let ctx: TestDbContext;
  let caseTypeId: CaseTypeId;
  let caseId: CaseId;
  let version: number;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("entel-movil");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
    const defined = await runtime().defineCaseType(MOVIL, OPERATION);
    if (!defined.ok) {
      throw new Error(`the case type must define: ${defined.error.code}`);
    }
    caseTypeId = defined.value.caseTypeId;
    const opened = await runtime().open(
      {
        actorUserId: EXECUTIVE,
        actorRole: "executive",
        caseTypeKey: MOVIL.key,
        organizationId: TEST_FIXTURES.organizations.lima.id,
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

  async function write(
    actor: { userId: UserId; role: Role },
    stageKey: string,
    values: Record<string, unknown>,
    status: string,
  ) {
    const result = await runtime().writeStage(
      {
        actorUserId: actor.userId,
        actorRole: actor.role,
        caseId,
        expectedVersion: version,
        stageKey,
        values,
        status,
      },
      OPERATION,
    );
    if (result.ok) {
      version = result.value.version;
    }
    return result;
  }

  async function queued(role: Role): Promise<boolean> {
    const waiting = await runtime().waiting({ caseTypeId, role });
    if (!waiting.ok) {
      throw new Error(waiting.error.code ?? "the queue must list");
    }
    return waiting.value.some((each) => each.id === caseId);
  }

  function storedValues() {
    return ctx.db
      .selectFrom("cases")
      .select("values")
      .where("id", "=", caseId)
      .executeTakeFirstOrThrow()
      .then((row) => row.values);
  }

  const validate = (status: string, correction = {}) =>
    write(
      { userId: STAFF, role: "supervisor" },
      "validacion",
      { comentario_validador: "revisado", ...correction },
      status,
    );

  const work = (status: string) =>
    write(
      { userId: BACK_OFFICE, role: "back_office" },
      "back",
      {
        fecha_actualizacion: "2026-11-18",
        comentario_back: "en proceso",
        nodo: "NODO 1",
        zonal: "TIENDA NORTE",
      },
      status,
    );

  it("moves from filing through validation, the back office and settlement", async () => {
    expect(await queued("supervisor")).toBe(true);
    expect(await queued("back_office")).toBe(false);
    expect(await queued("sales_manager")).toBe(false);

    expect((await validate("PROCEDE", { q_lineas: 4 })).ok).toBe(true);
    expect(await queued("supervisor")).toBe(false);
    expect(await queued("back_office")).toBe(true);
    expect(await queued("sales_manager")).toBe(true);

    expect((await work("ACTIVADO")).ok).toBe(true);
    expect(await queued("back_office")).toBe(false);

    const settled = await write(
      { userId: STAFF, role: "sales_manager" },
      "liquidacion",
      {
        comision: "S/ 300",
        observacion: "ACUERDO COMERCIAL",
        descuento: "0",
        fecha_liquidacion: "2026-11-25",
      },
      "LIQUIDADO",
    );
    expect(settled.ok).toBe(true);
    expect(await queued("sales_manager")).toBe(false);
    expect(await storedValues()).toMatchObject({
      q_lineas: 4,
      zonal: "TIENDA NORTE",
      comision: "S/ 300",
    });

    expect(await work("BOLSA")).toMatchObject({
      ok: false,
      error: { code: "case_stage_locked" },
    });
  });

  it("keeps a rejected order away from the back office", async () => {
    expect((await validate("RECHAZADO")).ok).toBe(true);

    expect(await queued("back_office")).toBe(false);
    expect(await queued("sales_manager")).toBe(false);
  });

  it("drops a fallen order from settlement", async () => {
    expect((await validate("PROCEDE")).ok).toBe(true);
    expect((await work("CAIDA")).ok).toBe(true);

    expect(await queued("sales_manager")).toBe(false);
  });
});
