import { describe, expect, it } from "vitest";

import {
  parseCalendarDate,
  type CalendarDate,
} from "~/domain/time/calendar-date";
import {
  caseFileIds,
  decideCaseOpening,
  decideReassign,
  decideStageWrite,
  decideTimeout,
  nextDeadlines,
  stageAccess,
  type CaseActor,
  type CaseProgress,
  type StageWrite,
} from "~/server/cases/domain/decide";
import {
  checkCaseTypeDefinition,
  type CaseStageTimeout,
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

const CENTRO = "branch-centro";
const NORTE = "branch-norte";
const BRANCH_IDS = new Set([CENTRO, NORTE]);

// Everyone works in Tienda Centro. The executive filed the case.
const EXECUTIVE: CaseActor = {
  roleKey: "executive",
  holdsCase: true,
  branchId: CENTRO,
};
const VALIDADOR: CaseActor = {
  roleKey: "validador",
  holdsCase: false,
  branchId: CENTRO,
};
const BACK_OFFICE: CaseActor = {
  roleKey: "back_office",
  holdsCase: false,
  branchId: CENTRO,
};
const SALES_MANAGER: CaseActor = {
  roleKey: "sales_manager",
  holdsCase: false,
  branchId: CENTRO,
};

const ENTEL = entelCaseTypes({
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

// The writer's own upload: a file field accepts only the files it may attach.
const UPLOAD = "file-own";

type Write = Omit<StageWrite, "today" | "branchIds" | "fileIds">;

function write(
  definition: CaseTypeDefinition,
  progress: CaseProgress,
  stageWrite: Write,
) {
  return decideStageWrite(definition, progress, {
    ...stageWrite,
    today: TODAY,
    branchIds: BRANCH_IDS,
    fileIds: new Set([UPLOAD]),
  });
}

function open(definition: CaseTypeDefinition, values: Record<string, unknown>) {
  return decideCaseOpening(definition, {
    actor: { roleKey: "executive", branchId: CENTRO },
    values,
    today: TODAY,
    branchIds: BRANCH_IDS,
    fileIds: new Set([UPLOAD]),
  });
}

// The shape of an Entel móvil nota de cargo: the executive files it, a
// validador validates it, and the back office works only a validated case.
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
      ownerRole: "validador",
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
  const opened = open(MOVIL, { q_lineas: 3, modalidad: "ALTA" });
  if (!opened.ok) {
    throw new Error("the fixture case must open");
  }
  return opened.value;
}

function validated(): CaseProgress {
  const result = write(MOVIL, filed(), {
    stageKey: "validacion",
    actor: VALIDADOR,
    values: { comentario_validador: "ok" },
    status: "PROCEDE",
  });
  if (!result.ok) {
    throw new Error("the fixture case must validate");
  }
  return result.value;
}

// The validador passes the filed case, writing the given values with it.
function rule(values: Record<string, unknown>) {
  return write(MOVIL, filed(), {
    stageKey: "validacion",
    actor: VALIDADOR,
    values: { comentario_validador: "ok", ...values },
    status: "PROCEDE",
  });
}

// The executive changes the line count on the case they filed.
function editLines(q_lineas: number) {
  return write(MOVIL, filed(), {
    stageKey: "registro",
    actor: EXECUTIVE,
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
    expect(open(MOVIL, { modalidad: "ALTA" })).toMatchObject({
      ok: false,
      error: {
        code: "case_fields_missing",
        details: { missing: ["q_lineas"] },
      },
    });
  });

  it("lets only the stage's role write it", () => {
    const result = write(MOVIL, filed(), {
      stageKey: "validacion",
      actor: EXECUTIVE,
      values: {},
      status: "PROCEDE",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "case_stage_not_owned" },
    });
  });

  it("keeps the back office out until validation passes", () => {
    const install: Write = {
      stageKey: "back",
      actor: BACK_OFFICE,
      values: { fecha_instalacion: "2026-11-16" },
      status: "INSTALADO",
    };
    expect(write(MOVIL, filed(), install)).toMatchObject({
      ok: false,
      error: { code: "case_stage_not_open" },
    });

    const rejected = write(MOVIL, filed(), {
      stageKey: "validacion",
      actor: VALIDADOR,
      values: { comentario_validador: "sin sustento" },
      status: "RECHAZADO",
    });
    if (!rejected.ok) {
      throw new Error("a validador can reject");
    }
    expect(write(MOVIL, rejected.value, install)).toMatchObject({
      ok: false,
      error: { code: "case_stage_not_open" },
    });

    expect(write(MOVIL, validated(), install)).toMatchObject({
      ok: true,
      value: {
        values: { fecha_instalacion: "2026-11-16" },
        statuses: { back: "INSTALADO" },
      },
    });
  });

  it("keeps settlement closed until every earlier gate has opened", () => {
    const settle: Write = {
      stageKey: "liquidacion",
      actor: SALES_MANAGER,
      values: {},
      status: "LIQUIDADO",
    };
    expect(write(MOVIL, filed(), settle)).toMatchObject({
      ok: false,
      error: { code: "case_stage_not_open" },
    });
    expect(write(MOVIL, validated(), settle)).toMatchObject({
      ok: true,
      value: { statuses: { back: "PENDIENTE", liquidacion: "LIQUIDADO" } },
    });
  });

  it("freezes the filed case once the validador has ruled", () => {
    const edit: Write = {
      stageKey: "registro",
      actor: EXECUTIVE,
      values: { q_lineas: 5 },
    };
    expect(write(MOVIL, filed(), edit).ok).toBe(true);
    expect(write(MOVIL, validated(), edit)).toMatchObject({
      ok: false,
      error: { code: "case_stage_locked" },
    });
  });

  it("keeps the filed case's required fields filled", () => {
    expect(editLines(5).ok).toBe(true);
    expect(
      write(MOVIL, filed(), {
        stageKey: "registro",
        actor: EXECUTIVE,
        values: { q_lineas: null },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "case_fields_missing",
        details: { missing: ["q_lineas"] },
      },
    });
  });

  it("keeps another executive out of a case they did not file", () => {
    const result = write(MOVIL, filed(), {
      stageKey: "registro",
      actor: { ...EXECUTIVE, holdsCase: false },
      values: { q_lineas: 5 },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "case_stage_not_owned" },
    });
  });

  it("lets the validador correct the line count it rules on", () => {
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
    const result = write(MOVIL, validated(), {
      stageKey: "back",
      actor: BACK_OFFICE,
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
    const result = write(MOVIL, filed(), {
      stageKey: "validacion",
      actor: VALIDADOR,
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
    const result = write(MOVIL, filed(), {
      stageKey: "registro",
      actor: EXECUTIVE,
      values,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "case_fields_invalid" },
    });
  });

  it("rejects a date the month does not have", () => {
    const result = write(MOVIL, validated(), {
      stageKey: "back",
      actor: BACK_OFFICE,
      values: { fecha_instalacion: "2026-02-30" },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "case_fields_invalid" },
    });
  });

  it("rejects a status the stage does not have", () => {
    const result = write(MOVIL, filed(), {
      stageKey: "validacion",
      actor: VALIDADOR,
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
  zonal: CENTRO,
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
  return open(entel("quiebre"), { ...BREAK_FILING, ...values });
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
    const opened = open(fija, {
      zonal: CENTRO,
      producto: "INTERNET 200",
      modalidad: "ALTA",
      contacto: "Luis Demo",
      telefono1: "900000003",
      direccion: "Av. Demo 123",
      tecnologia: "FTTH",
    });
    if (!opened.ok) {
      throw new Error("the fixed order must open");
    }
    const validatedOrder = write(fija, opened.value, {
      stageKey: "validacion",
      actor: VALIDADOR,
      values: { comentario_validador: "ok" },
      status: "PROCEDE",
    });
    if (!validatedOrder.ok) {
      throw new Error("the fixed order must validate");
    }
    const work = (status: string, values: Record<string, unknown> = {}) =>
      write(fija, validatedOrder.value, {
        stageKey: "back",
        actor: BACK_OFFICE,
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

function filedBreak(): CaseProgress {
  const opened = openBreak({});
  if (!opened.ok) {
    throw new Error("the fixture quiebre must open");
  }
  return opened.value;
}

// The validador takes a filed quiebre into the given status.
function breakAt(status: string): CaseProgress {
  const worked = write(entel("quiebre"), filedBreak(), {
    stageKey: "validacion",
    actor: VALIDADOR,
    values: { caso_sf: "SF-0001" },
    status,
  });
  if (!worked.ok) {
    throw new Error(`the fixture quiebre must reach ${status}`);
  }
  return worked.value;
}

function amendBreak(
  progress: CaseProgress,
  values: Record<string, unknown>,
  status?: string,
) {
  return write(entel("quiebre"), progress, {
    stageKey: "registro",
    actor: EXECUTIVE,
    values,
    status,
  });
}

function breakAccess(
  progress: CaseProgress,
  stageKey: string,
  actor: CaseActor,
) {
  const quiebre = entel("quiebre");
  const stage = quiebre.stages.find((each) => each.key === stageKey);
  if (!stage) {
    throw new Error(`the quiebre has a ${stageKey} stage`);
  }
  return stageAccess(quiebre, progress, stage, actor);
}

describe("amending a quiebre under validation", () => {
  it("lets the executive update the contacts while the validador works it", () => {
    const processing = breakAt("PROCESANDO");
    expect(breakAccess(processing, "registro", EXECUTIVE)).toBe("amending");
    expect(
      amendBreak(processing, { celular1: "900000009" }, "REGISTRADO"),
    ).toMatchObject({
      ok: true,
      value: {
        values: { celular1: "900000009" },
        statuses: { validacion: "PROCESANDO" },
      },
    });
  });

  it("keeps the rest of the filing as the validador read it", () => {
    expect(
      amendBreak(breakAt("PROCESANDO"), { fecha_activacion: "2026-10-02" }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "case_fields_invalid",
        details: { rejected: ["fecha_activacion"] },
      },
    });
  });

  it("refuses to clear a required contact", () => {
    expect(amendBreak(breakAt("PROCESANDO"), { contacto1: "" })).toMatchObject({
      ok: false,
      error: {
        code: "case_fields_missing",
        details: { missing: ["contacto1"] },
      },
    });
  });

  it("locks the filing once the validador has answered", () => {
    const attended = breakAt("ATENDIDO");
    expect(breakAccess(attended, "registro", EXECUTIVE)).toBe("locked");
    expect(amendBreak(attended, { celular1: "900000009" })).toMatchObject({
      ok: false,
      error: { code: "case_stage_locked" },
    });
  });
});

describe("validating a quiebre in the tienda it names", () => {
  const norteValidador: CaseActor = { ...VALIDADOR, branchId: NORTE };

  it("leaves the quiebre to the named tienda's validador", () => {
    const filing = filedBreak();
    expect(breakAccess(filing, "validacion", VALIDADOR)).toBe("writable");
    expect(breakAccess(filing, "validacion", norteValidador)).toBe(
      "other_branch",
    );
    expect(
      write(entel("quiebre"), filing, {
        stageKey: "validacion",
        actor: norteValidador,
        values: { caso_sf: "SF-0001" },
        status: "ATENDIDO",
      }),
    ).toMatchObject({ ok: false, error: { code: "case_stage_not_owned" } });
  });

  it("files a quiebre only for a branch of the workspace", () => {
    expect(openBreak({ zonal: "TIENDA CENTRO" })).toMatchObject({
      ok: false,
      error: {
        code: "case_fields_invalid",
        details: { rejected: ["zonal"] },
      },
    });
  });
});

// A pricing reservation: the executive holds a price for two days, then it
// lapses unless the deal is won. The proof of the deal is a file.
const RESERVA: CaseTypeDefinition = {
  key: "reserva",
  name: "Reserva de precio",
  stages: [
    {
      key: "reserva",
      name: "Reserva",
      ownerRole: "executive",
      statuses: ["RESERVADO", "GANADO", "LIBERADO"],
      initialStatus: "RESERVADO",
      gate: null,
      timeout: { whileStatus: "RESERVADO", afterHours: 48, moveTo: "LIBERADO" },
    },
    {
      key: "cierre",
      name: "Cierre",
      ownerRole: "back_office",
      statuses: ["PENDIENTE", "CERRADO"],
      initialStatus: "PENDIENTE",
      gate: { stageKey: "reserva", statuses: ["GANADO"] },
    },
  ],
  fields: [
    {
      key: "constancia",
      stageKey: "reserva",
      label: "Constancia",
      kind: "file",
      choices: null,
      required: false,
    },
  ],
};

const OPENED_AT = new Date("2026-11-16T15:00:00.000Z");
const DUE_AT = new Date("2026-11-18T15:00:00.000Z");

function reserved(): CaseProgress {
  const opened = open(RESERVA, {});
  if (!opened.ok) {
    throw new Error("the reservation must open");
  }
  return opened.value;
}

function writeReserva(status: string, values: Record<string, unknown> = {}) {
  return write(RESERVA, reserved(), {
    stageKey: "reserva",
    actor: EXECUTIVE,
    values,
    status,
  });
}

describe("file fields", () => {
  it("holds only a file the writer may attach", () => {
    const attached = writeReserva("RESERVADO", { constancia: UPLOAD });
    expect(attached).toMatchObject({
      ok: true,
      value: { values: { constancia: UPLOAD } },
    });
    if (!attached.ok) {
      throw new Error("the file must attach");
    }
    expect(caseFileIds(RESERVA, attached.value.values)).toEqual([UPLOAD]);
    expect(
      writeReserva("RESERVADO", { constancia: "file-other" }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "case_fields_invalid",
        details: { rejected: ["constancia"] },
      },
    });
  });
});

describe("stage timeouts", () => {
  it("starts the count when the case opens in the waiting status", () => {
    expect(nextDeadlines(RESERVA, null, reserved(), {}, OPENED_AT)).toEqual({
      reserva: DUE_AT,
    });
  });

  it("keeps the due date while the stage waits, and clears it when it moves", () => {
    const current = { reserva: DUE_AT };
    const later = new Date("2026-11-17T15:00:00.000Z");
    const kept = writeReserva("RESERVADO", { constancia: UPLOAD });
    const won = writeReserva("GANADO");
    if (!kept.ok || !won.ok) {
      throw new Error("the reservation must take both writes");
    }
    expect(
      nextDeadlines(RESERVA, reserved(), kept.value, current, later),
    ).toEqual({ reserva: DUE_AT });
    expect(
      nextDeadlines(RESERVA, reserved(), won.value, current, later),
    ).toEqual({ reserva: null });
  });

  it("moves the stage only once its due date has passed", () => {
    const early = new Date("2026-11-18T14:59:59.000Z");
    expect(
      decideTimeout(RESERVA, reserved(), "reserva", DUE_AT, early),
    ).toMatchObject({ ok: false, error: { code: "case_stage_not_due" } });
    expect(
      decideTimeout(RESERVA, reserved(), "reserva", DUE_AT, DUE_AT),
    ).toMatchObject({
      ok: true,
      value: { statuses: { reserva: "LIBERADO", cierre: "PENDIENTE" } },
    });
  });

  it("leaves a stage that moved after the sweep read it", () => {
    const won = writeReserva("GANADO");
    if (!won.ok) {
      throw new Error("the reservation must be won");
    }
    expect(
      decideTimeout(RESERVA, won.value, "reserva", DUE_AT, DUE_AT),
    ).toMatchObject({ ok: false, error: { code: "case_stage_not_due" } });
  });

  it("names each problem in a stage's timeout", () => {
    const [reserva, cierre] = RESERVA.stages;
    if (!reserva || !cierre) {
      throw new Error("RESERVA has two stages");
    }
    const timed = (timeout: CaseStageTimeout) =>
      checkCaseTypeDefinition({
        ...RESERVA,
        stages: [{ ...reserva, timeout }, cierre],
      });
    expect(
      timed({ whileStatus: "ESPERA", afterHours: 48, moveTo: "LIBERADO" }),
    ).toMatchObject({
      error: {
        details: {
          problems: ["stage reserva times out on an unknown status"],
        },
      },
    });
    expect(
      timed({ whileStatus: "RESERVADO", afterHours: 0.5, moveTo: "RESERVADO" }),
    ).toMatchObject({
      error: {
        details: {
          problems: [
            "stage reserva times out into the status it waits in",
            "stage reserva times out after a bad number of hours",
          ],
        },
      },
    });
  });
});

describe("reassigning a case", () => {
  it("hands the case only to an active user of the opening stage's role", () => {
    expect(
      decideReassign(RESERVA, { active: true, roleKey: "executive" }),
    ).toEqual({ ok: true, value: null });
    for (const target of [
      { active: false, roleKey: "executive" },
      { active: true, roleKey: "back_office" },
      { active: true, roleKey: null },
    ]) {
      expect(decideReassign(RESERVA, target)).toMatchObject({
        ok: false,
        error: { code: "case_holder_invalid" },
      });
    }
  });
});

function branchField(key: string, stageKey: string) {
  return {
    key,
    stageKey,
    label: "Sede",
    kind: "branch" as const,
    choices: null,
    required: true,
  };
}

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
        {
          key: "sede",
          stageKey: "registro",
          label: "Sede",
          kind: "branch",
          choices: ["CENTRO"],
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
            "field sede lists choices but is not a choice",
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

  it("names each problem in an amendable field", () => {
    const [qLineas, ...rest] = MOVIL.fields;
    if (!qLineas) {
      throw new Error("MOVIL has fields");
    }
    const amendable = (stageKey: string, statuses: string[]) =>
      checkCaseTypeDefinition({
        ...MOVIL,
        fields: [
          { ...qLineas, amendableWhile: { stageKey, statuses } },
          ...rest,
        ],
      });
    expect(amendable("validacion", ["PENDIENTE"]).ok).toBe(true);
    for (const stageKey of ["registro", "desconocida"]) {
      expect(amendable(stageKey, ["PENDIENTE"])).toMatchObject({
        ok: false,
        error: {
          details: {
            problems: [
              "field q_lineas stays amendable on a stage that does not follow its own",
            ],
          },
        },
      });
    }
    expect(amendable("validacion", ["CERRADO"])).toMatchObject({
      ok: false,
      error: {
        details: {
          problems: ["field q_lineas stays amendable at an unknown status"],
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

  it("scopes a stage only by a branch field an earlier stage fills", () => {
    const [registro, validacion, ...later] = MOVIL.stages;
    if (!registro || !validacion) {
      throw new Error("MOVIL has stages");
    }
    const scoped = (field: string) =>
      checkCaseTypeDefinition({
        ...MOVIL,
        stages: [registro, { ...validacion, branchField: field }, ...later],
        fields: [
          ...MOVIL.fields,
          branchField("sede", "registro"),
          branchField("sede_validacion", "validacion"),
        ],
      });
    expect(scoped("sede").ok).toBe(true);
    for (const field of ["modalidad", "sede_validacion", "desconocido"]) {
      expect(scoped(field)).toMatchObject({
        ok: false,
        error: {
          details: {
            problems: [
              "stage validacion is scoped by a field that is not an earlier branch",
            ],
          },
        },
      });
    }
  });
});
