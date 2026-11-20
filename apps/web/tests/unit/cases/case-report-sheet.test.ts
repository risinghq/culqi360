import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { sheetWorkbook } from "~/browser/files/sheet";
import type { CaseTypeDefinition } from "~/server/cases/domain/definition";
import { buildCaseReportSheet } from "~/server/cases/export/sheet";
import type { CaseReportRow } from "~/server/cases/infrastructure/cases-repo";

const DEFINITION: CaseTypeDefinition = {
  key: "quiebre",
  name: "Quiebre",
  stages: [
    {
      key: "registro",
      name: "Registro",
      ownerRole: "executive",
      statuses: ["REGISTRADO"],
      initialStatus: "REGISTRADO",
      gate: null,
    },
    {
      key: "back",
      name: "Back",
      ownerRole: "back_office",
      statuses: ["PENDIENTE", "ATENDIDO"],
      initialStatus: "PENDIENTE",
      gate: { stageKey: "registro", statuses: ["REGISTRADO"] },
    },
  ],
  fields: [
    {
      key: "zonal",
      stageKey: "registro",
      label: "Zonal",
      kind: "branch",
      choices: null,
      required: true,
    },
    {
      key: "comentario_ejecutivo",
      stageKey: "registro",
      label: "Comentario",
      kind: "text",
      choices: null,
      required: false,
    },
    {
      key: "fecha_atencion",
      stageKey: "back",
      label: "Atención",
      kind: "date",
      choices: null,
      required: true,
    },
    {
      key: "comentario_back",
      stageKey: "back",
      label: "Comentario",
      kind: "text",
      choices: null,
      required: false,
    },
  ],
};

const ROW: CaseReportRow = {
  ruc: "20100000001",
  legalName: "Demo SAC",
  holderName: "Exec One",
  createdAt: new Date("2026-11-16T15:00:00.000Z"),
  updatedAt: new Date("2026-11-17T15:00:00.000Z"),
  values: {
    zonal: "branch-lima",
    comentario_ejecutivo: "llamar en la tarde",
    fecha_atencion: "2026-11-20",
    comentario_back: "",
  },
  stages: {
    registro: {
      status: "REGISTRADO",
      userName: "Exec One",
      at: new Date("2026-11-16T15:00:00.000Z"),
    },
    back: {
      status: "ATENDIDO",
      userName: null,
      at: new Date("2026-11-17T15:00:00.000Z"),
    },
  },
};

function readSheet(bytes: Uint8Array) {
  const workbook = XLSX.read(bytes);
  const sheet = workbook.Sheets.Casos;
  if (!sheet) {
    throw new Error("the report must have a Casos sheet");
  }
  return XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    raw: false,
    defval: "",
  });
}

describe("case report sheet", () => {
  it("writes one row per case with the branch name, the stage trail and day-first dates", async () => {
    const sheet = buildCaseReportSheet(
      {
        definition: DEFINITION,
        rows: [ROW],
        branchNames: new Map([["branch-lima", "Lima"]]),
      },
      new Date("2026-11-18T15:00:00.000Z"),
    );

    expect(sheet.filename).toBe("quiebre 2026-11-18.xlsx");
    expect(readSheet(await sheetWorkbook(sheet))).toEqual([
      {
        RUC: "20100000001",
        "Razón social": "Demo SAC",
        Responsable: "Exec One",
        "Fecha de registro": "16/11/2026",
        "Última actualización": "17/11/2026",
        "Registro: estado": "REGISTRADO",
        "Registro: responsable": "Exec One",
        "Registro: fecha": "16/11/2026",
        Zonal: "Lima",
        "Comentario (Registro)": "llamar en la tarde",
        "Back: estado": "ATENDIDO",
        "Back: responsable": "",
        "Back: fecha": "17/11/2026",
        Atención: "20/11/2026",
        "Comentario (Back)": "",
      },
    ]);
  });
});
