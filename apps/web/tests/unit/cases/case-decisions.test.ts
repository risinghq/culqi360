import { describe, expect, it } from "vitest";

import {
  decideCaseOpening,
  decideStageWrite,
  type CaseProgress,
} from "~/server/cases/domain/decide";
import {
  checkCaseTypeDefinition,
  type CaseTypeDefinition,
} from "~/server/cases/domain/definition";

// The shape of an Entel móvil nota de cargo: the executive files it, a
// supervisor validates it, and the back office works only a validated case.
const MOVIL: CaseTypeDefinition = {
  key: "nc_movil",
  name: "Nota de cargo móvil",
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
      key: "validacion",
      name: "Validación",
      ownerRole: "supervisor",
      statuses: ["PENDIENTE", "PROCEDE", "RECHAZADO"],
      initialStatus: "PENDIENTE",
      gate: { stageKey: "registro", statuses: ["REGISTRADO"] },
    },
    {
      key: "back",
      name: "Back",
      ownerRole: "back_office",
      statuses: ["PENDIENTE", "INSTALADO"],
      initialStatus: "PENDIENTE",
      gate: { stageKey: "validacion", statuses: ["PROCEDE"] },
    },
  ],
  fields: [
    {
      key: "q_lineas",
      stageKey: "registro",
      label: "Líneas",
      kind: "number",
      choices: null,
      required: true,
    },
    {
      key: "modalidad",
      stageKey: "registro",
      label: "Modalidad",
      kind: "choice",
      choices: ["ALTA", "PORTABILIDAD"],
      required: false,
    },
    {
      key: "comentario_validador",
      stageKey: "validacion",
      label: "Comentario",
      kind: "text",
      choices: null,
      required: true,
    },
    {
      key: "fecha_instalacion",
      stageKey: "back",
      label: "Instalación",
      kind: "date",
      choices: null,
      required: false,
    },
  ],
};

function filed(): CaseProgress {
  const opened = decideCaseOpening(MOVIL, {
    actorRole: "executive",
    values: { q_lineas: 3, modalidad: "ALTA" },
  });
  if (!opened.ok) {
    throw new Error("the fixture case must open");
  }
  return opened.value;
}

function validated(): CaseProgress {
  const result = decideStageWrite(MOVIL, filed(), {
    stageKey: "validacion",
    actorRole: "supervisor",
    actorOwnsCase: false,
    values: { comentario_validador: "ok" },
    status: "PROCEDE",
  });
  if (!result.ok) {
    throw new Error("the fixture case must validate");
  }
  return result.value;
}

describe("case decisions", () => {
  it("opens a case with every stage at its initial status", () => {
    expect(filed()).toEqual({
      values: { q_lineas: 3, modalidad: "ALTA" },
      statuses: {
        registro: "REGISTRADO",
        validacion: "PENDIENTE",
        back: "PENDIENTE",
      },
    });
  });

  it("refuses to open a case without the opening stage's required fields", () => {
    const opened = decideCaseOpening(MOVIL, {
      actorRole: "executive",
      values: { modalidad: "ALTA" },
    });
    expect(opened).toMatchObject({
      ok: false,
      error: {
        code: "case_fields_missing",
        details: { missing: ["q_lineas"] },
      },
    });
  });

  it("lets only the stage's role write it", () => {
    const result = decideStageWrite(MOVIL, filed(), {
      stageKey: "validacion",
      actorRole: "executive",
      actorOwnsCase: true,
      values: {},
      status: "PROCEDE",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "case_stage_not_owned" },
    });
  });

  it("keeps the back office out until validation passes", () => {
    const write = {
      stageKey: "back",
      actorRole: "back_office" as const,
      actorOwnsCase: false,
      values: { fecha_instalacion: "2026-11-16" },
      status: "INSTALADO",
    };
    expect(decideStageWrite(MOVIL, filed(), write)).toMatchObject({
      ok: false,
      error: { code: "case_stage_not_open" },
    });

    const rejected = decideStageWrite(MOVIL, filed(), {
      stageKey: "validacion",
      actorRole: "supervisor",
      actorOwnsCase: false,
      values: { comentario_validador: "sin sustento" },
      status: "RECHAZADO",
    });
    if (!rejected.ok) {
      throw new Error("a supervisor can reject");
    }
    expect(decideStageWrite(MOVIL, rejected.value, write)).toMatchObject({
      ok: false,
      error: { code: "case_stage_not_open" },
    });

    expect(decideStageWrite(MOVIL, validated(), write)).toMatchObject({
      ok: true,
      value: {
        values: { fecha_instalacion: "2026-11-16" },
        statuses: { back: "INSTALADO" },
      },
    });
  });

  it("freezes the filed case once the supervisor has ruled", () => {
    const edit = {
      stageKey: "registro",
      actorRole: "executive" as const,
      actorOwnsCase: true,
      values: { q_lineas: 5 },
    };
    expect(decideStageWrite(MOVIL, filed(), edit).ok).toBe(true);
    expect(decideStageWrite(MOVIL, validated(), edit)).toMatchObject({
      ok: false,
      error: { code: "case_stage_locked" },
    });
  });

  it("keeps another executive out of a case they did not file", () => {
    const result = decideStageWrite(MOVIL, filed(), {
      stageKey: "registro",
      actorRole: "executive",
      actorOwnsCase: false,
      values: { q_lineas: 5 },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "case_stage_not_owned" },
    });
  });

  it("writes only the stage's own fields", () => {
    const result = decideStageWrite(MOVIL, validated(), {
      stageKey: "back",
      actorRole: "back_office",
      actorOwnsCase: false,
      values: { q_lineas: 9 },
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "case_fields_invalid",
        details: { rejected: ["q_lineas"] },
      },
    });
  });

  it("requires the stage's fields before it leaves its initial status", () => {
    const result = decideStageWrite(MOVIL, filed(), {
      stageKey: "validacion",
      actorRole: "supervisor",
      actorOwnsCase: false,
      values: {},
      status: "PROCEDE",
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "case_fields_missing",
        details: { missing: ["comentario_validador"] },
      },
    });
  });

  it.each([
    ["number", { q_lineas: "3" }],
    ["choice", { modalidad: "BAM" }],
  ])("rejects a %s value the field cannot hold", (_kind, values) => {
    const result = decideStageWrite(MOVIL, filed(), {
      stageKey: "registro",
      actorRole: "executive",
      actorOwnsCase: true,
      values,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "case_fields_invalid" },
    });
  });

  it("rejects a date the month does not have", () => {
    const result = decideStageWrite(MOVIL, validated(), {
      stageKey: "back",
      actorRole: "back_office",
      actorOwnsCase: false,
      values: { fecha_instalacion: "2026-02-30" },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "case_fields_invalid" },
    });
  });

  it("rejects a status the stage does not have", () => {
    const result = decideStageWrite(MOVIL, filed(), {
      stageKey: "validacion",
      actorRole: "supervisor",
      actorOwnsCase: false,
      values: { comentario_validador: "ok" },
      status: "COMPLETADO",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "case_status_invalid" },
    });
  });
});

describe("case type definitions", () => {
  it("accepts a process whose gates point back to earlier stages", () => {
    expect(checkCaseTypeDefinition(MOVIL).ok).toBe(true);
  });

  it("names each problem in a broken process", () => {
    const [registro, validacion, back] = MOVIL.stages;
    if (!registro || !validacion || !back) {
      throw new Error("MOVIL has three stages");
    }
    const broken: CaseTypeDefinition = {
      ...MOVIL,
      stages: [
        registro,
        { ...back, gate: { stageKey: "validacion", statuses: ["PROCEDE"] } },
        {
          ...validacion,
          gate: { stageKey: "registro", statuses: ["CERRADO"] },
        },
      ],
      fields: [
        ...MOVIL.fields,
        {
          key: "plan",
          stageKey: "registro",
          label: "Plan",
          kind: "choice",
          choices: [],
          required: false,
        },
      ],
    };
    expect(checkCaseTypeDefinition(broken)).toMatchObject({
      ok: false,
      error: {
        code: "case_type_invalid",
        details: {
          problems: [
            "stage back is gated on a later or unknown stage",
            "stage validacion is gated on an unknown status",
            "choice field plan has no choices",
          ],
        },
      },
    });
  });
});
