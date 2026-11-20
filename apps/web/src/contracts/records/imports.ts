export type RecordImportType = "import_status" | "import_prioridad";

/** The most lines the browser reads from one records file. */
export const MAX_RECORD_IMPORT_ROWS = 10_000;

/** Lines the browser sends per import call. Each call is one transaction
 * and must stay inside Workers Free's 10 ms of CPU per invocation; the
 * records bench measures one batch. */
export const RECORD_IMPORT_BATCH_LINES = 6;

// Each import type has two templates: the dealer report and the lookup
// export. A header matches only when it has exactly these columns, in order.
const RECORD_IMPORT_TEMPLATES: readonly {
  type: RecordImportType;
  columns: readonly string[];
}[] = [
  {
    type: "import_status",
    columns: [
      "nro_de_solicitud",
      "fecha_de_solicitud",
      "canal",
      "nombre_de_agencia_dealer",
      "documento",
      "resultado",
    ],
  },
  {
    type: "import_status",
    columns: [
      "documento_a_consultar",
      "resultado",
      "identificador_interno",
      "nro._linea",
    ],
  },
  {
    type: "import_prioridad",
    columns: [
      "nro_de_solicitud",
      "fecha",
      "usuario",
      "dealer",
      "documento",
      "segmento",
      "prioridad",
      "categoria",
    ],
  },
  {
    type: "import_prioridad",
    columns: [
      "documento_a_consultar",
      "segmento",
      "prioridad",
      "evaluacion",
      "identificador_interno",
      "nro._linea",
    ],
  },
];

/** The import type whose template the normalized columns match, or null. */
export function recordImportType(
  columns: readonly string[],
): RecordImportType | null {
  const template = RECORD_IMPORT_TEMPLATES.find(
    (each) =>
      each.columns.length === columns.length &&
      each.columns.every((column, index) => column === columns[index]),
  );
  return template?.type ?? null;
}
