import type {
  CaseFieldDefinition,
  CaseStageDefinition,
  CaseTypeDefinition,
} from "~/server/cases/domain/definition";

type FieldSpec = Omit<
  CaseFieldDefinition,
  "stageKey" | "choices" | "required"
> & {
  choices?: readonly string[];
  required?: boolean;
};

function stageFields(
  stageKey: string,
  specs: readonly FieldSpec[],
): CaseFieldDefinition[] {
  return specs.map(({ choices, required, ...spec }) => ({
    ...spec,
    stageKey,
    choices: choices ?? null,
    required: required ?? false,
  }));
}

const registro: CaseStageDefinition = {
  key: "registro",
  name: "Registro",
  ownerRole: "executive",
  statuses: ["REGISTRADO"],
  initialStatus: "REGISTRADO",
  gate: null,
};

// CRM Entel's back office validates two sales in three; its supervisors the
// rest. One role owns the stage, so the back office does.
function validacion(statuses: readonly string[]): CaseStageDefinition {
  return {
    key: "validacion",
    name: "Validación",
    ownerRole: "back_office",
    statuses,
    initialStatus: "PENDIENTE",
    gate: { stageKey: "registro", statuses: ["REGISTRADO"] },
  };
}

const SALE_FIELDS: readonly FieldSpec[] = [
  { key: "fecha", label: "Fecha de venta", kind: "date", required: true },
  {
    key: "q_lineas",
    label: "Cantidad de líneas",
    kind: "number",
    required: true,
    bounds: { min: 0, integer: true },
  },
  {
    key: "cargo_fijo",
    label: "Cargo fijo",
    kind: "number",
    required: true,
    bounds: { min: 0 },
  },
  { key: "planes", label: "Planes", kind: "text" },
  { key: "contacto", label: "Contacto", kind: "text" },
  { key: "telefono1", label: "Teléfono", kind: "text" },
];

export const MOBILE_SALE: CaseTypeDefinition = {
  key: "venta_movil",
  name: "Venta móvil",
  stages: [
    registro,
    validacion(["PENDIENTE", "PROCEDE", "RECHAZADO", "RECHAZO_TOTAL"]),
    {
      key: "back",
      name: "Activación",
      ownerRole: "back_office",
      statuses: [
        "PENDIENTE",
        "EN_PROCESO",
        "ACTIVADO",
        "REASIGNACION",
        "RECHAZADO_OPERATIVO",
        "CANCELADO",
      ],
      initialStatus: "PENDIENTE",
      gate: { stageKey: "validacion", statuses: ["PROCEDE"] },
    },
    // Entel pays the dealer twice: when it charges the sale (cargo) and when
    // the lines stay active long enough (ganancia).
    {
      key: "comision",
      name: "Comisión",
      ownerRole: "sales_manager",
      statuses: ["PENDIENTE", "CARGADO", "GANADO"],
      initialStatus: "PENDIENTE",
      gate: { stageKey: "back", statuses: ["ACTIVADO"] },
    },
  ],
  fields: [
    ...stageFields("registro", [
      ...SALE_FIELDS,
      {
        key: "tipo_producto",
        label: "Tipo de producto",
        kind: "choice",
        choices: ["M4", "COMBO"],
        required: true,
      },
      {
        key: "entrega",
        label: "Entrega",
        kind: "choice",
        choices: [
          "DELIVERY",
          "RECOJO_EN_TIENDA",
          "CHIP_EN_MANO",
          "CARTA_PODER",
        ],
        required: true,
      },
      {
        key: "lineas_portabilidad",
        label: "Líneas en portabilidad",
        kind: "number",
        bounds: { min: 0, integer: true },
      },
      {
        key: "lineas_alta",
        label: "Líneas nuevas",
        kind: "number",
        bounds: { min: 0, integer: true },
      },
      { key: "operadoras", label: "Operadoras de origen", kind: "text" },
      { key: "grupo", label: "Grupo", kind: "text" },
      { key: "comentario", label: "Comentario", kind: "text" },
    ]),
    ...stageFields("validacion", [
      {
        key: "comentario_validacion",
        label: "Comentario de validación",
        kind: "text",
      },
    ]),
    ...stageFields("back", [
      { key: "comentario_back", label: "Comentario del back", kind: "text" },
      { key: "fecha_activacion", label: "Fecha de activación", kind: "date" },
    ]),
    ...stageFields("comision", [
      { key: "mes_cargo", label: "Mes de cargo", kind: "text" },
      { key: "mes_ganancia", label: "Mes de ganancia", kind: "text" },
    ]),
  ],
};

export const FIXED_SALE: CaseTypeDefinition = {
  key: "venta_fija",
  name: "Venta fija",
  stages: [
    registro,
    validacion(["PENDIENTE", "PROCEDE", "RECHAZO_TOTAL"]),
    {
      key: "back",
      name: "Instalación",
      ownerRole: "back_office",
      statuses: ["PENDIENTE", "EN_OT_SAF", "ACTIVADO", "RECHAZADO"],
      initialStatus: "PENDIENTE",
      gate: { stageKey: "validacion", statuses: ["PROCEDE"] },
    },
  ],
  fields: [
    ...stageFields("registro", [
      ...SALE_FIELDS,
      { key: "comentario", label: "Comentario", kind: "text" },
    ]),
    ...stageFields("validacion", [
      {
        key: "comentario_validacion",
        label: "Comentario de validación",
        kind: "text",
      },
    ]),
    ...stageFields("back", [
      { key: "codigo_ot", label: "Código OT", kind: "text" },
      { key: "codigo_saf", label: "Código SAF", kind: "text" },
      { key: "comentario_back", label: "Comentario del back", kind: "text" },
      {
        key: "fecha_instalacion",
        label: "Fecha de instalación",
        kind: "date",
      },
      { key: "fecha_activacion", label: "Fecha de activación", kind: "date" },
    ]),
  ],
};
