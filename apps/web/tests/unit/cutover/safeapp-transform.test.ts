import { safeappSnapshot, sequentialIds } from "@tests/support/safeapp";
import { describe, expect, it } from "vitest";

import type { SourceRow } from "~/server/cutover/safeapp/source";
import {
  planSafeappCutover,
  roleFromGrants,
  type CutoverPlan,
} from "~/server/cutover/safeapp/transform";

const AT = new Date("2026-11-16T15:00:00.000Z");

function plan(snapshot = safeappSnapshot()): CutoverPlan {
  return planSafeappCutover({ snapshot, newId: sequentialIds(), at: AT });
}

function userNamed(result: CutoverPlan, username: string) {
  const user = result.users.find((each) => each.username === username);
  if (!user) {
    throw new Error(`no user ${username}`);
  }
  return user;
}

function branchNamed(result: CutoverPlan, name: string) {
  const branch = result.branches.find((each) => each.name === name);
  if (!branch) {
    throw new Error(`no branch ${name}`);
  }
  return branch;
}

function onlyCase(result: CutoverPlan, caseTypeKey: string) {
  const found = result.cases.filter((each) => each.caseTypeKey === caseTypeKey);
  expect(found).toHaveLength(1);
  const [only] = found;
  if (!only) {
    throw new Error(`no ${caseTypeKey} case`);
  }
  return only;
}

describe("safeapp cutover plan", () => {
  it("gives each user the strongest role their grants allow", () => {
    expect(roleFromGrants("ADMINISTRADOR", new Set())).toBe("admin");
    expect(roleFromGrants("AGENTE", new Set(["usuarios.manage"]))).toBe(
      "admin",
    );
    expect(
      roleFromGrants(
        "SUPERVISOR",
        new Set(["notacargo.movil.validar", "liquidacion.gestionar"]),
      ),
    ).toBe("sales_manager");
    expect(
      roleFromGrants(
        "AGENTE",
        new Set(["notacargo.fija.back", "quiebre.validar"]),
      ),
    ).toBe("back_office");
    expect(roleFromGrants("SUPERVISOR", new Set(["quiebre.validar"]))).toBe(
      "supervisor",
    );
    expect(
      roleFromGrants("AGENTE", new Set(["notacargo.movil.registrar"])),
    ).toBe("executive");
  });

  it("maps users onto their active tienda, names and a unique email", () => {
    const result = plan();
    const executive = userNamed(result, "ejecutivo.demo");
    expect(executive).toMatchObject({
      branchId: branchNamed(result, "Tienda Uno").id,
      names: "Eva Maria",
      firstSurname: "Ejecutiva",
      secondSurname: "Demo",
      email: "ejecutivo@demo.invalid",
      role: "executive",
      isActive: true,
    });
    expect(userNamed(result, "admin.demo").role).toBe("admin");
    // The validador repeats the executive's address.
    expect(userNamed(result, "validador.demo")).toMatchObject({
      email: "validador.demo@safeapp.invalid",
      names: "Victor",
      firstSurname: "Validador",
      secondSurname: "",
    });
    expect(userNamed(result, "back.demo")).toMatchObject({
      role: "back_office",
      isActive: false,
    });
    expect(userNamed(result, "liquidador.demo")).toMatchObject({
      role: "sales_manager",
      branchId: branchNamed(result, "Sin tienda").id,
      email: "liquidador.demo@safeapp.invalid",
    });
  });

  it("adds no Sin tienda branch when every user has a tienda", () => {
    const base = safeappSnapshot();
    const result = plan(
      safeappSnapshot({
        usuario: base.usuario.filter((row) => row.id_usuario !== "5"),
        acceso: base.acceso.filter((row) => row.id_usuario !== "5"),
        asignacion_tienda: [
          ...base.asignacion_tienda,
          { id_usuario: "1", id_tienda: "1", estado: "0" },
        ],
      }),
    );
    expect(result.branches.map((branch) => branch.name)).toEqual([
      "Tienda Uno",
      "Tienda Dos",
    ]);
  });

  it("keeps the first of two users with one username", () => {
    const base = safeappSnapshot();
    const repeated: SourceRow = {
      id_usuario: "9",
      usuario: " EJECUTIVO.DEMO ",
      personal: "Otra Persona",
      id_rol: "3",
      estado: "1",
    };
    const result = plan(
      safeappSnapshot({ usuario: [...base.usuario, repeated] }),
    );
    expect(result.users).toHaveLength(5);
    expect(result.report.skipped).toContainEqual({
      table: "usuario",
      sourceId: "9",
      reason: "username_repeated",
    });
  });

  it("loads the active catalog entries and those a case names", () => {
    const result = plan();
    const movil = result.caseTypes.find((each) => each.key === "nc_movil");
    const fija = result.caseTypes.find((each) => each.key === "nc_fija");
    expect(
      movil?.fields.find((field) => field.key === "cartera")?.choices,
    ).toEqual(["CARTERA ACTIVA", "CARTERA ANTIGUA"]);
    expect(
      fija?.fields.find((field) => field.key === "producto")?.choices,
    ).toEqual(["INTERNET - 200 MB", "INTERNET - 50 MB"]);
  });

  it("carries a settled mobile order's stages, writers and Lima dates", () => {
    const result = plan();
    const movil = onlyCase(result, "nc_movil");
    const validador = userNamed(result, "validador.demo").id;
    const back = userNamed(result, "back.demo").id;

    expect(movil.ownerUserId).toBe(userNamed(result, "ejecutivo.demo").id);
    expect(movil.createdAt).toEqual(new Date("2026-03-02T05:00:00.000Z"));
    expect(movil.updatedAt).toEqual(new Date("2026-04-01T05:00:00.000Z"));
    expect(movil.stages).toEqual([
      {
        stageKey: "registro",
        status: "REGISTRADO",
        updatedBy: movil.ownerUserId,
        updatedAt: new Date("2026-03-02T05:00:00.000Z"),
      },
      {
        stageKey: "validacion",
        status: "PROCEDE",
        updatedBy: validador,
        updatedAt: new Date("2026-03-03T05:00:00.000Z"),
      },
      {
        stageKey: "back",
        status: "ACTIVADO",
        updatedBy: back,
        updatedAt: new Date("2026-03-10T05:00:00.000Z"),
      },
      {
        stageKey: "liquidacion",
        status: "LIQUIDADO",
        updatedBy: null,
        updatedAt: new Date("2026-04-01T05:00:00.000Z"),
      },
    ]);
    expect(movil.values).toMatchObject({
      zonal: branchNamed(result, "Tienda Uno").id,
      q_lineas: 5,
      cargo_fijo: 120.5,
      cartera: "CARTERA ANTIGUA",
      fecha_liquidacion: "2026-04-01",
      telefono1: "900000001",
    });
    expect(movil.values).not.toHaveProperty("telefono2");
  });

  it("leaves an unworked stage unattributed at the filing date", () => {
    const fija = onlyCase(plan(), "nc_fija");
    expect(fija.values).toMatchObject({ producto: "INTERNET - 50 MB" });
    expect(fija.stages.slice(1)).toEqual([
      {
        stageKey: "validacion",
        status: "PENDIENTE",
        updatedBy: null,
        updatedAt: new Date("2026-05-04T05:00:00.000Z"),
      },
      {
        stageKey: "back",
        status: "XINGRESAR",
        updatedBy: null,
        updatedAt: new Date("2026-05-04T05:00:00.000Z"),
      },
    ]);
  });

  it("reads the quiebre's tienda from zonal_telefonica and status from estado", () => {
    const result = plan();
    const quiebre = onlyCase(result, "quiebre");
    expect(quiebre.values).toMatchObject({
      zonal: branchNamed(result, "Tienda Dos").id,
      caso_sf: "SF-1",
    });
    expect(quiebre.stages.map((stage) => stage.status)).toEqual([
      "REGISTRADO",
      "PROCESANDO",
    ]);
  });

  it("skips cases it cannot place and counts what it could not resolve", () => {
    const base = safeappSnapshot();
    const [movil] = base.nc_movil;
    const result = plan(
      safeappSnapshot({
        cliente: [
          ...base.cliente,
          { id_cliente: "3", ruc: "2099", razon_social: "RUC corto" },
        ],
        nc_movil: [
          { ...movil, id_cargo: "101", estado: "INVENTADO" },
          { ...movil, id_cargo: "102", id_usuario: "77" },
          { ...movil, id_cargo: "103", id_cliente: "3" },
          { ...movil, id_cargo: "104", id_back: "88", zonal: "99" },
        ],
      }),
    );
    expect(result.report.skipped).toEqual([
      { table: "cliente", sourceId: "3", reason: "invalid_ruc" },
      { table: "nc_movil", sourceId: "101", reason: "unknown_status:back" },
      { table: "nc_movil", sourceId: "102", reason: "owner_missing" },
      { table: "nc_movil", sourceId: "103", reason: "organization_missing" },
    ]);
    expect(result.report.warnings).toEqual({
      "nc_movil.id_back: unknown user": 1,
      "nc_movil.zonal: unknown tienda": 1,
    });
    const kept = result.cases.find((each) => each.caseTypeKey === "nc_movil");
    expect(
      kept?.stages.find((stage) => stage.stageKey === "back")?.updatedBy,
    ).toBeNull();
    expect(kept?.values).not.toHaveProperty("zonal");
  });

  it("trims a RUC and keeps a blank legal name empty", () => {
    const result = plan();
    expect(result.organizations).toContainEqual(
      expect.objectContaining({ ruc: "20999999002", legalName: null }),
    );
  });
});
