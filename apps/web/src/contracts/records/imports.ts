export type RecordImportType = "import_status" | "import_prioridad";

/** The most lines one records import sends. The server maps them in one
 * request and hands them to a job. */
export const MAX_RECORD_IMPORT_ROWS = 10_000;

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

/** What the import is applying, which decides the wording of its progress. */
export interface RecordImportDetail {
  importType: RecordImportType;
}

export function parseRecordImportDetail(
  value: unknown,
): RecordImportDetail | null {
  if (typeof value !== "object" || value === null || !("importType" in value)) {
    return null;
  }

  const { importType } = value;

  return importType === "import_status" || importType === "import_prioridad"
    ? { importType }
    : null;
}
