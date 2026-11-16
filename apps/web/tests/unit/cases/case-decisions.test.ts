import { describe, expect, it } from "vitest";

import {
  parseCalendarDate,
  type CalendarDate,
} from "~/domain/time/calendar-date";
import {
  decideCaseOpening,
  decideStageWrite,
  type CaseProgress,
} from "~/server/cases/domain/decide";
import {
  checkCaseTypeDefinition,
  type CaseTypeDefinition,
} from "~/server/cases/domain/definition";
import { entelCaseTypes } from "~/server/cases/presets/entel";

function calendarDate(value: string): CalendarDate {
  const date = parseCalendarDate(value);
  if (!date) {
    throw new Error(`${value} is not a calendar date`);
  }
  return date;
}

const TODAY = calendarDate("2026-11-16");

const ENTEL = entelCaseTypes({
  zonales: ["TIENDA CENTRO"],
  carteras: ["CARTERA A"],
  fixedProducts: ["INTERNET 200"],
});

function entel(key: string): CaseTypeDefinition {
  const found = ENTEL.find((each) => each.key === key);
  if (!found) {
    throw new Error(`Entel has no ${key} process`);
  }
  return found;
}

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
    // Settlement accepts a case the back office has not moved yet, so its
    // gate lists back's initial status.
    {
      key: "liquidacion",
      name: "Liquidación",
      ownerRole: "sales_manager",
      statuses: ["PENDIENTE", "LIQUIDADO"],
      initialStatus: "PENDIENTE",
      gate: { stageKey: "back", statuses: ["PENDIENTE", "INSTALADO"] },
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
      bounds: { min: 1, integer: true },
      correctedBy: ["validacion"],
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
    today: TODAY,
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
    today: TODAY,
    actorOwnsCase: false,
    values: { comentario_validador: "ok" },
    status: "PROCEDE",
  });
  if (!result.ok) {
    throw new Error("the fixture case must validate");
  }
  return result.value;
}

// The supervisor passes the filed case, writing the given values with it.
function rule(values: Record<string, unknown>) {
  return decideStageWrite(MOVIL, filed(), {
    stageKey: "validacion",
    actorRole: "supervisor",
    today: TODAY,
    actorOwnsCase: false,
    values: { comentario_validador: "ok", ...values },
    status: "PROCEDE",
  });
}

// The executive changes the line count on the case they filed.
function editLines(q_lineas: number) {
  return decideStageWrite(MOVIL, filed(), {
    stageKey: "registro",
    actorRole: "executive",
    today: TODAY,
    actorOwnsCase: true,
    values: { q_lineas },
  });
}

describe("case decisions", () => {
  it("opens a case with every stage at its initial status", () => {
    expect(filed()).toEqual({
      values: { q_lineas: 3, modalidad: "ALTA" },
      statuses: {
        registro: "REGISTRADO",
        validacion: "PENDIENTE",
        back: "PENDIENTE",
        liquidacion: "PENDIENTE",
      },
    });
  });

  it("refuses to open a case without the opening stage's required fields", () => {
    const opened = decideCaseOpening(MOVIL, {
      actorRole: "executive",
      today: TODAY,
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
      today: TODAY,
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
      today: TODAY,
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
      today: TODAY,
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

  it("keeps settlement closed until every earlier gate has opened", () => {
    const settle = {
      stageKey: "liquidacion",
      actorRole: "sales_manager" as const,
      today: TODAY,
      actorOwnsCase: false,
      values: {},
      status: "LIQUIDADO",
    };
    expect(decideStageWrite(MOVIL, filed(), settle)).toMatchObject({
      ok: false,
      error: { code: "case_stage_not_open" },
    });
    expect(decideStageWrite(MOVIL, validated(), settle)).toMatchObject({
      ok: true,
      value: { statuses: { back: "PENDIENTE", liquidacion: "LIQUIDADO" } },
    });
  });

  it("freezes the filed case once the supervisor has ruled", () => {
    const edit = {
      stageKey: "registro",
      actorRole: "executive" as const,
      today: TODAY,
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
      today: TODAY,
      actorOwnsCase: false,
      values: { q_lineas: 5 },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "case_stage_not_owned" },
    });
  });

  it("lets the supervisor correct the line count it rules on", () => {
    expect(rule({ q_lineas: 2 })).toMatchObject({
      ok: true,
      value: { values: { q_lineas: 2, modalidad: "ALTA" } },
    });
    expect(rule({ modalidad: "PORTABILIDAD" })).toMatchObject({
      ok: false,
      error: { details: { rejected: ["modalidad"] } },
    });
    expect(rule({ q_lineas: null })).toMatchObject({
      ok: false,
      error: {
        code: "case_fields_missing",
        details: { missing: ["q_lineas"] },
      },
    });
  });

  it("writes only the stage's own fields and the ones it corrects", () => {
    const result = decideStageWrite(MOVIL, validated(), {
      stageKey: "back",
      actorRole: "back_office",
      today: TODAY,
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
      today: TODAY,
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
      today: TODAY,
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
      today: TODAY,
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
      today: TODAY,
      actorOwnsCase: false,
      values: { comentario_validador: "ok" },
      status: "COMPLETADO",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "case_status_invalid" },
    });
  });

  it("rejects a line count outside its bounds", () => {
    expect(editLines(1).ok).toBe(true);
    for (const q_lineas of [0, 1.5]) {
      expect(editLines(q_lineas)).toMatchObject({
        ok: false,
        error: {
          code: "case_fields_invalid",
          details: { rejected: ["q_lineas"] },
        },
      });
    }
  });
});

// Invented demo values for a filed Entel quiebre.
const BREAK_FILING = {
  zonal: "TIENDA CENTRO",
  servicio: "MOVIL",
  tipo_averia: "SIN DATOS",
  numero_problema: "900000001",
  problema_equipo: "NO",
  fecha_activacion: "2026-10-01",
  contacto1: "Ana Demo",
  celular1: "900000002",
  correo1: "ana@example.com",
};

function openBreak(values: Record<string, unknown>) {
  return decideCaseOpening(entel("quiebre"), {
    actorRole: "executive",
    today: TODAY,
    values: { ...BREAK_FILING, ...values },
  });
}

describe("conditionally required fields", () => {
  it("asks for the equipment only when the break is an equipment problem", () => {
    expect(openBreak({}).ok).toBe(true);
    expect(openBreak({ problema_equipo: "SI" })).toMatchObject({
      ok: false,
      error: {
        code: "case_fields_missing",
        details: { missing: ["detalle_equipo"] },
      },
    });
    expect(
      openBreak({ problema_equipo: "SI", detalle_equipo: "MODEM" }).ok,
    ).toBe(true);
  });

  it("asks for Entel's ticket once the line is 90 days old", () => {
    expect(openBreak({ fecha_activacion: "2026-08-19" }).ok).toBe(true);
    expect(openBreak({ fecha_activacion: "2026-08-18" })).toMatchObject({
      ok: false,
      error: {
        code: "case_fields_missing",
        details: { missing: ["numero_ticket", "fecha_ticket_atencion"] },
      },
    });
  });

  it("asks for the settlement date when the back office completes a fixed order", () => {
    const fija = entel("nc_fija");
    const opened = decideCaseOpening(fija, {
      actorRole: "executive",
      today: TODAY,
      values: {
        zonal: "TIENDA CENTRO",
        producto: "INTERNET 200",
        modalidad: "ALTA",
        contacto: "Luis Demo",
        telefono1: "900000003",
        direccion: "Av. Demo 123",
        tecnologia: "FTTH",
      },
    });
    if (!opened.ok) {
      throw new Error("the fixed order must open");
    }
    const validatedOrder = decideStageWrite(fija, opened.value, {
      stageKey: "validacion",
      actorRole: "supervisor",
      today: TODAY,
      actorOwnsCase: false,
      values: { comentario_validador: "ok" },
      status: "PROCEDE",
    });
    if (!validatedOrder.ok) {
      throw new Error("the fixed order must validate");
    }
    const work = (status: string, values: Record<string, unknown> = {}) =>
      decideStageWrite(fija, validatedOrder.value, {
        stageKey: "back",
        actorRole: "back_office",
        today: TODAY,
        actorOwnsCase: false,
        values: { comentario_back: "instalado", nodo: "NAT", ...values },
        status,
      });

    expect(work("INICIADO").ok).toBe(true);
    expect(work("COMPLETADO")).toMatchObject({
      ok: false,
      error: {
        code: "case_fields_missing",
        details: { missing: ["fecha_liquidacion"] },
      },
    });
    expect(work("COMPLETADO", { fecha_liquidacion: "2026-11-16" }).ok).toBe(
      true,
    );
  });
});

describe("case type definitions", () => {
  it("accepts a process whose gates point back to earlier stages", () => {
    expect(checkCaseTypeDefinition(MOVIL).ok).toBe(true);
  });

  it("accepts each Entel process", () => {
    expect(
      ENTEL.map((preset) => [preset.key, checkCaseTypeDefinition(preset).ok]),
    ).toEqual([
      ["nc_movil", true],
      ["nc_fija", true],
      ["quiebre", true],
    ]);
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

  it("names each problem in a field's bounds", () => {
    const [qLineas, modalidad, ...rest] = MOVIL.fields;
    if (!qLineas || !modalidad) {
      throw new Error("MOVIL has fields");
    }
    expect(
      checkCaseTypeDefinition({
        ...MOVIL,
        fields: [
          { ...qLineas, bounds: { min: 5, max: 1 } },
          { ...modalidad, bounds: { min: 0 } },
          ...rest,
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: {
        details: {
          problems: [
            "field q_lineas has a minimum above its maximum",
            "field modalidad has bounds but is not a number",
          ],
        },
      },
    });
  });

  it("names each problem in a field's condition", () => {
    const text = { kind: "text" as const, choices: null, label: "Dato" };
    expect(
      checkCaseTypeDefinition({
        ...MOVIL,
        fields: [
          ...MOVIL.fields,
          {
            ...text,
            key: "motivo",
            stageKey: "validacion",
            required: true,
            requiredWhen: { kind: "status", statuses: ["PROCEDE"] },
          },
          {
            ...text,
            key: "cierre",
            stageKey: "back",
            required: false,
            requiredWhen: { kind: "status", statuses: ["CERRADO"] },
          },
          {
            ...text,
            key: "otro",
            stageKey: "registro",
            required: false,
            requiredWhen: { kind: "value", fieldKey: "nada", values: ["SI"] },
          },
          {
            ...text,
            key: "detalle",
            stageKey: "registro",
            required: false,
            requiredWhen: {
              kind: "value",
              fieldKey: "modalidad",
              values: ["BAM"],
            },
          },
          {
            ...text,
            key: "ticket",
            stageKey: "registro",
            required: false,
            requiredWhen: { kind: "age", fieldKey: "modalidad", days: 0 },
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: {
        details: {
          problems: [
            "field motivo is required and also conditional",
            "field cierre is required at an unknown status",
            "field otro depends on an unknown field",
            "field detalle depends on a value its source cannot hold",
            "field ticket counts age from a field that is not a date",
            "field ticket counts age in a bad number of days",
          ],
        },
      },
    });
  });

  it("refuses a correction by a stage that does not follow the field's stage", () => {
    const [qLineas, ...rest] = MOVIL.fields;
    if (!qLineas) {
      throw new Error("MOVIL has fields");
    }
    const corrected = (correctedBy: string[]) =>
      checkCaseTypeDefinition({
        ...MOVIL,
        fields: [{ ...qLineas, correctedBy }, ...rest],
      });
    expect(corrected(["liquidacion"]).ok).toBe(true);
    for (const stageKey of ["registro", "desconocida"]) {
      expect(corrected([stageKey])).toMatchObject({
        ok: false,
        error: {
          details: {
            problems: [
              "field q_lineas is corrected by a stage that does not follow its own",
            ],
          },
        },
      });
    }
  });
});
