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
      "validador",
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
      roleKey: "executive",
      isActive: true,
    });
    expect(userNamed(result, "admin.demo").roleKey).toBe("admin");
    // The validador repeats the executive's address.
    expect(userNamed(result, "validador.demo")).toMatchObject({
      email: "validador.demo@safeapp.invalid",
      names: "Victor",
      firstSurname: "Validador",
      secondSurname: "",
    });
    expect(userNamed(result, "back.demo")).toMatchObject({
      roleKey: "back_office",
      isActive: false,
    });
    expect(userNamed(result, "liquidador.demo")).toMatchObject({
      roleKey: "sales_manager",
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

  it("makes each tipo_data a campaign and each origen a segment", () => {
    const result = plan();
    const campaignNamed = (name: string) =>
      result.campaigns.find((each) => each.name === name)?.id;
    expect(result.campaigns.map((each) => each.name)).toEqual([
      "MOVIL",
      "FIJA",
    ]);
    const [worked, open, fija] = result.campaignRecords;
    expect(worked).toMatchObject({
      campaignId: campaignNamed("MOVIL"),
      segment: "BASE NOVIEMBRE",
      facts: { zonal: "LIMA", nodo: "N1", q_movistar: "3", q_entel: "0" },
      // The latest call to the dato dates it, as Lima time.
      workedAt: new Date("2026-10-02T15:30:00.000Z"),
    });
    expect(open).toMatchObject({ workedAt: null, facts: {} });
    expect(fija).toMatchObject({
      campaignId: campaignNamed("FIJA"),
      segment: "INHOUSE",
    });
  });

  it("keeps each assignment and closes the released ones", () => {
    const result = plan();
    const [worked, open] = result.campaignRecords;
    expect(result.campaignAssignments).toEqual([
      {
        recordId: worked?.id,
        userId: userNamed(result, "ejecutivo.demo").id,
        assignedAt: new Date("2026-10-01T05:00:00.000Z"),
        releasedAt: null,
      },
      {
        recordId: open?.id,
        userId: userNamed(result, "ejecutivo.demo").id,
        assignedAt: new Date("2026-10-01T05:00:00.000Z"),
        releasedAt: new Date("2026-10-05T05:00:00.000Z"),
      },
      {
        recordId: open?.id,
        userId: userNamed(result, "validador.demo").id,
        assignedAt: new Date("2026-10-06T05:00:00.000Z"),
        releasedAt: null,
      },
    ]);
  });

  it("imports each llamada as a call with its outcome and contact", () => {
    const result = plan();
    const executive = userNamed(result, "ejecutivo.demo");
    const [worked] = result.campaignRecords;
    expect(result.calls).toEqual([
      expect.objectContaining({
        userId: executive.id,
        branchId: executive.branchId,
        organizationId: worked?.organizationId,
        campaignRecordId: worked?.id,
        phone: "900000002",
        startedAt: new Date("2026-10-02T15:30:00.000Z"),
        outcome: "VOLVER A LLAMAR",
        notes:
          "Contacto: Contacto Demo (contacto@demo.invalid)\nLlamar el lunes",
      }),
      expect.objectContaining({
        campaignRecordId: null,
        phone: null,
        startedAt: new Date("2026-10-03T14:00:00.000Z"),
        outcome: "NO CONTESTA",
        notes: null,
      }),
    ]);
  });

  it("merges datos of one RUC and reports campaign rows it cannot place", () => {
    const base = safeappSnapshot();
    const [call] = base.llamada;
    const result = plan(
      safeappSnapshot({
        // Cliente 3 repeats cliente 1's RUC.
        cliente: [
          ...base.cliente,
          { id_cliente: "3", ruc: "20999999001", razon_social: "Duplicado" },
        ],
        datos: [
          ...base.datos,
          {
            id_dato: "4",
            id_cliente: "3",
            origen: "BASE NOVIEMBRE",
            tipo_data: "MOVIL",
            estado: "0",
          },
          {
            id_dato: "5",
            id_cliente: "77",
            origen: "BASE NOVIEMBRE",
            tipo_data: "MOVIL",
            estado: "0",
          },
          { id_dato: "6", id_cliente: "1", origen: "", tipo_data: "MOVIL" },
        ],
        asignacion_datos: [
          ...base.asignacion_datos,
          // A second open holder of dato 1, through its merged dato.
          {
            id_asignacion: "4",
            id_dato: "4",
            id_usuario: "3",
            fecha_asignacion: "2026-10-07",
            activa: "1",
          },
          { id_asignacion: "5", id_dato: "5", id_usuario: "2", activa: "1" },
          { id_asignacion: "6", id_dato: "3", id_usuario: "77", activa: "1" },
        ],
        llamada: [
          ...base.llamada,
          { ...call, id_llamada: "3", id_usuario: "77" },
          { ...call, id_llamada: "4", fecha: "0000-00-00 00:00:00" },
          { ...call, id_llamada: "5", id_dato: "99", id_respuesta: "9" },
          { ...call, id_llamada: "6", id_cliente: "2" },
        ],
      }),
    );
    expect(result.campaignRecords).toHaveLength(3);
    expect(result.report.skipped).toEqual([
      { table: "datos", sourceId: "5", reason: "organization_missing" },
      { table: "datos", sourceId: "6", reason: "segment_missing" },
      { table: "asignacion_datos", sourceId: "5", reason: "record_missing" },
      { table: "asignacion_datos", sourceId: "6", reason: "user_missing" },
      { table: "llamada", sourceId: "3", reason: "user_missing" },
      { table: "llamada", sourceId: "4", reason: "date_missing" },
    ]);
    expect(result.report.warnings).toEqual({
      "datos: merged with a dato of the same RUC": 1,
      "asignacion_datos: record held twice": 1,
      "llamada.id_dato: unknown dato": 1,
      "llamada.id_respuesta: unknown respuesta": 1,
      "llamada.id_dato: dato of another cliente": 1,
    });
    const [worked] = result.campaignRecords;
    const holders = result.campaignAssignments.filter(
      (each) => each.recordId === worked?.id,
    );
    expect(holders).toEqual([
      expect.objectContaining({
        releasedAt: new Date("2026-10-07T05:00:00.000Z"),
      }),
      expect.objectContaining({
        userId: userNamed(result, "validador.demo").id,
        releasedAt: null,
      }),
    ]);
    const unlinked = result.calls.filter(
      (each) => each.campaignRecordId === null,
    );
    expect(unlinked).toHaveLength(3);
  });

  it("trims a RUC and keeps a blank legal name empty", () => {
    const result = plan();
    expect(result.organizations).toContainEqual(
      expect.objectContaining({ ruc: "20999999002", legalName: null }),
    );
  });
});
