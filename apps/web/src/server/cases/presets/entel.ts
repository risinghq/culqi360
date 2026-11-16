import type {
  CaseFieldDefinition,
  CaseStageDefinition,
  CaseTypeDefinition,
} from "../domain/definition";

// Entel's catalogs differ per workspace and come from its data at cutover, so
// the case types take them rather than hold them.
export type EntelCatalog = {
  // Entel's tiendas, which safeapp calls zonales.
  zonales: readonly string[];
  carteras: readonly string[];
  fixedProducts: readonly string[];
};

const ETAPAS = [
  "F1-PERDIDA",
  "F1-GANADA",
  "F2-GESTION",
  "F3-NEGOCIACION",
  "F4-DISENO",
  "F5-DEFINICION",
];

const MOBILE_ESTADOS = [
  "PENDIENTE",
  "PROCESANDO",
  "INGRESADO",
  "DELIVERY",
  "ACTIVADO",
  "CAIDA",
  "BOLSA",
  "SALIDAANTICIPADA",
  "LIQUIDADO",
  "ADR",
];

// A fallen case is not settled.
const SETTLEABLE_ESTADOS = MOBILE_ESTADOS.filter(
  (estado) => estado !== "CAIDA" && estado !== "ADR",
);

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

const validacion: CaseStageDefinition = {
  key: "validacion",
  name: "Validación",
  ownerRole: "supervisor",
  statuses: ["PENDIENTE", "PROCEDE", "RECHAZADO"],
  initialStatus: "PENDIENTE",
  gate: { stageKey: "registro", statuses: ["REGISTRADO"] },
};

const validatorComment: FieldSpec = {
  key: "comentario_validador",
  label: "Comentario del validador",
  kind: "text",
  required: true,
};

function mobileOrder(catalog: EntelCatalog): CaseTypeDefinition {
  return {
    key: "nc_movil",
    name: "Nota de cargo móvil",
    stages: [
      registro,
      validacion,
      {
        key: "back",
        name: "Back",
        ownerRole: "back_office",
        statuses: MOBILE_ESTADOS,
        initialStatus: "PENDIENTE",
        gate: { stageKey: "validacion", statuses: ["PROCEDE"] },
      },
      {
        key: "liquidacion",
        name: "Liquidación",
        ownerRole: "sales_manager",
        statuses: ["PENDIENTE", "LIQUIDADO"],
        initialStatus: "PENDIENTE",
        gate: { stageKey: "back", statuses: SETTLEABLE_ESTADOS },
      },
    ],
    fields: [
      ...stageFields("registro", [
        {
          key: "zonal",
          label: "Zonal",
          kind: "choice",
          choices: catalog.zonales,
          required: true,
          correctedBy: ["back"],
        },
        {
          key: "q_lineas",
          label: "Cantidad de líneas",
          kind: "number",
          required: true,
          correctedBy: ["validacion"],
        },
        {
          key: "cargo_fijo",
          label: "Cargo fijo",
          kind: "number",
          required: true,
          correctedBy: ["validacion"],
        },
        {
          key: "modalidad",
          label: "Modalidad",
          kind: "choice",
          choices: ["ALTA", "PORTABILIDAD", "BAM"],
          required: true,
        },
        { key: "contacto", label: "Contacto", kind: "text", required: true },
        { key: "telefono1", label: "Teléfono", kind: "text", required: true },
        { key: "telefono2", label: "Teléfono 2", kind: "text" },
        {
          key: "nivel_negociacion",
          label: "Nivel de negociación (%)",
          kind: "choice",
          choices: ["25", "50", "75", "100"],
          required: true,
        },
        {
          key: "fecha_estimada",
          label: "Fecha estimada",
          kind: "date",
          required: true,
        },
        {
          key: "tipo_producto",
          label: "Tipo de producto",
          kind: "choice",
          choices: ["M4", "COMBO", "M4/COMBO"],
          required: true,
        },
        {
          key: "etapa",
          label: "Etapa",
          kind: "choice",
          choices: ETAPAS,
          required: true,
          correctedBy: ["back"],
        },
        {
          key: "oportunidad",
          label: "Oportunidad",
          kind: "text",
          correctedBy: ["back"],
        },
        {
          key: "cartera",
          label: "Cartera",
          kind: "choice",
          choices: catalog.carteras,
          correctedBy: ["back"],
        },
        { key: "comentario_ejecutivo", label: "Comentario", kind: "text" },
      ]),
      ...stageFields("validacion", [validatorComment]),
      ...stageFields("back", [
        {
          key: "fecha_actualizacion",
          label: "Fecha de actualización",
          kind: "date",
          required: true,
        },
        {
          key: "comentario_back",
          label: "Comentario del back",
          kind: "text",
          required: true,
        },
        { key: "nodo", label: "Nodo", kind: "text", required: true },
        { key: "casofwa", label: "Caso FWA", kind: "text" },
        { key: "ciclo", label: "Ciclo", kind: "text" },
        {
          key: "cuenta_financiera",
          label: "Cuenta financiera",
          kind: "text",
        },
      ]),
      ...stageFields("liquidacion", [
        { key: "comision", label: "Comisión", kind: "text", required: true },
        {
          key: "observacion",
          label: "Observación",
          kind: "choice",
          choices: [
            "DEUDA",
            "BAJA",
            "BAJA PARCIAL",
            "PORT OUT",
            "SUSPENSION",
            "ACUERDO COMERCIAL",
          ],
          required: true,
        },
        { key: "descuento", label: "Descuento", kind: "text", required: true },
        {
          key: "fecha_liquidacion",
          label: "Fecha de liquidación",
          kind: "date",
          required: true,
        },
        {
          key: "comentario_liquidador",
          label: "Comentario del liquidador",
          kind: "text",
        },
      ]),
    ],
  };
}

function fixedOrder(catalog: EntelCatalog): CaseTypeDefinition {
  return {
    key: "nc_fija",
    name: "Nota de cargo fija",
    stages: [
      registro,
      validacion,
      {
        key: "back",
        name: "Back",
        ownerRole: "back_office",
        statuses: [
          "XINGRESAR",
          "PENDIENTE",
          "AGENDADO",
          "INICIADO",
          "OBSERVADO",
          "ARBITRAJE",
          "BOLSA",
          "ADR",
          "COMPLETADO",
          "CANCELADO",
        ],
        initialStatus: "XINGRESAR",
        gate: { stageKey: "validacion", statuses: ["PROCEDE"] },
      },
    ],
    fields: [
      ...stageFields("registro", [
        {
          key: "zonal",
          label: "Zonal",
          kind: "choice",
          choices: catalog.zonales,
          required: true,
          correctedBy: ["back"],
        },
        {
          key: "producto",
          label: "Producto",
          kind: "choice",
          choices: catalog.fixedProducts,
          required: true,
        },
        { key: "cargo_fijo", label: "Cargo fijo", kind: "number" },
        {
          key: "modalidad",
          label: "Modalidad",
          kind: "choice",
          choices: ["ALTA", "PORTABILIDAD", "FUNNEL"],
          required: true,
        },
        { key: "contacto", label: "Contacto", kind: "text", required: true },
        { key: "telefono1", label: "Teléfono", kind: "text", required: true },
        { key: "telefono2", label: "Teléfono 2", kind: "text" },
        { key: "direccion", label: "Dirección", kind: "text", required: true },
        { key: "coordenadas", label: "Coordenadas", kind: "text" },
        {
          key: "tecnologia",
          label: "Tecnología",
          kind: "choice",
          choices: ["FTTH", "HFC", "GPON"],
          required: true,
        },
        { key: "comentario", label: "Comentario", kind: "text" },
      ]),
      ...stageFields("validacion", [validatorComment]),
      ...stageFields("back", [
        {
          key: "comentario_back",
          label: "Comentario del back",
          kind: "text",
          required: true,
        },
        {
          key: "nodo",
          label: "Nodo",
          kind: "choice",
          choices: ["SINNODO", "NAT", "NCP", "VACANTE", "RESERVADO"],
          required: true,
        },
        { key: "peticion", label: "Petición", kind: "text" },
        { key: "contrata", label: "Contrata", kind: "text" },
        { key: "nasignado", label: "Número asignado", kind: "text" },
        { key: "caso_sf", label: "Caso SF", kind: "text" },
        { key: "ncfinanciera", label: "NC financiera", kind: "text" },
        { key: "ncfe", label: "NC FE", kind: "text" },
        {
          key: "fecha_liquidacion",
          label: "Fecha de liquidación",
          kind: "date",
        },
      ]),
    ],
  };
}

function serviceBreak(catalog: EntelCatalog): CaseTypeDefinition {
  return {
    key: "quiebre",
    name: "Quiebre",
    stages: [
      registro,
      {
        ...validacion,
        statuses: ["PENDIENTE", "ATENDIDO", "PROCESANDO", "DEVUELTO"],
      },
    ],
    fields: [
      ...stageFields("registro", [
        {
          key: "zonal",
          label: "Zonal",
          kind: "choice",
          choices: catalog.zonales,
          required: true,
        },
        {
          key: "servicio",
          label: "Servicio",
          kind: "choice",
          choices: ["FIJA", "MOVIL"],
          required: true,
        },
        {
          key: "tipo_averia",
          label: "Tipo de avería",
          kind: "choice",
          choices: [
            "SIN TV",
            "SIN DATOS",
            "NO PUEDE REALIZAR / RECIBIR LLAMADAS",
            "SIN SERVICIO",
            "FALLA EQUIPO",
            "DUPLICIDAD DE RECIBOS",
            "FACTURA DE EQUIPOS",
            "DESCUENTO NO APLICADO",
            "CASI",
            "CAEQ",
            "REGISTRO CCAA",
            "INCIDENCIA PAGO APP",
            "AJUSTE FACTURACION",
            "IMPACTO PAGOS",
            "SOLICITUD BAJA",
            "CAMBIO TITULARIDAD",
            "AGRUPACION LINEAS",
            "RECLAMO FACTURACION",
            "OTROS",
          ],
          required: true,
        },
        {
          key: "numero_problema",
          label: "Número con problema",
          kind: "text",
          required: true,
        },
        {
          key: "problema_equipo",
          label: "Problema de equipo",
          kind: "choice",
          choices: ["SI", "NO"],
          required: true,
        },
        {
          key: "detalle_equipo",
          label: "Detalle del equipo",
          kind: "choice",
          choices: ["DECO", "BAM", "MODEM", "CELULAR", "TELEFONO", "OTROS"],
        },
        {
          key: "fecha_activacion",
          label: "Fecha de activación",
          kind: "date",
          required: true,
        },
        {
          key: "fecha_inicio_averia",
          label: "Inicio de la avería",
          kind: "date",
        },
        { key: "numero_ticket", label: "Número de ticket", kind: "text" },
        {
          key: "fecha_ticket_atencion",
          label: "Fecha de atención del ticket",
          kind: "date",
        },
        { key: "contacto1", label: "Contacto", kind: "text", required: true },
        { key: "celular1", label: "Celular", kind: "text", required: true },
        { key: "correo1", label: "Correo", kind: "text", required: true },
        { key: "contacto2", label: "Contacto 2", kind: "text" },
        { key: "celular2", label: "Celular 2", kind: "text" },
        { key: "correo2", label: "Correo 2", kind: "text" },
        { key: "comentario_ejecutivo", label: "Comentario", kind: "text" },
      ]),
      ...stageFields("validacion", [
        { key: "caso_sf", label: "Caso SF", kind: "text", required: true },
        { ...validatorComment, required: false },
      ]),
    ],
  };
}

// Entel's processes as safeapp runs them: the executive files, a supervisor
// validates, the back office works the order, and the sales manager settles a
// mobile order.
export function entelCaseTypes(catalog: EntelCatalog): CaseTypeDefinition[] {
  return [mobileOrder(catalog), fixedOrder(catalog), serviceBreak(catalog)];
}
