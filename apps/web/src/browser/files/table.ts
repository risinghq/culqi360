import { parseCsvRows } from "~/shared/csv";
import { findTableBody, type TableBody, type TableLine } from "~/shared/table";

export type TableFileKind = "csv" | "xlsx";

/** The largest file an import reads; a bigger one would stall the tab. */
export const MAX_TABLE_FILE_BYTES = 20 * 1024 * 1024;

export function tableFileKind(name: string): TableFileKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) {
    return "csv";
  }
  if (lower.endsWith(".xlsx")) {
    return "xlsx";
  }
  return null;
}

function csvTables(text: string): TableLine[][] {
  return ([",", ";"] as const).map((delimiter) =>
    parseCsvRows(text, delimiter).map((row) => ({
      line: row.rowNumber,
      cells: row.cells,
    })),
  );
}

// Cells are read as the sheet displays them, so a RUC stored as a number
// keeps its digits and a date keeps the format the user typed.
async function workbookTables(bytes: ArrayBuffer): Promise<TableLine[][]> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(bytes, { type: "array" });
  return workbook.SheetNames.flatMap((name) => {
    const sheet = workbook.Sheets[name];
    if (sheet === undefined) {
      return [];
    }
    const firstRow = XLSX.utils.decode_range(sheet["!ref"] ?? "A1").s.r;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
    });
    return [
      rows.map((cells, index) => ({
        line: firstRow + index + 1,
        cells: cells.map(String),
      })),
    ];
  });
}

/** Reads a csv or xlsx file into candidate tables: one per csv delimiter,
 * one per workbook sheet. xlsx is loaded on the first workbook read. */
export async function readTables(
  file: File,
  kind: TableFileKind,
): Promise<TableLine[][]> {
  return kind === "csv"
    ? csvTables(await file.text())
    : workbookTables(await file.arrayBuffer());
}

export type TableFileRead =
  | { ok: true; table: TableBody }
  | { ok: false; message: string };

/** Reads an import file in the browser and finds the table under the first
 * line `isHeader` accepts. Failures carry the message the user sees. */
export async function readTableFile(
  file: File,
  options: {
    isHeader: (columns: readonly string[]) => boolean;
    maxLines: number;
    missingHeader: string;
  },
): Promise<TableFileRead> {
  const kind = tableFileKind(file.name);
  if (kind === null) {
    return { ok: false, message: "El archivo debe ser CSV o Excel (.xlsx)." };
  }
  if (file.size > MAX_TABLE_FILE_BYTES) {
    return { ok: false, message: "El archivo supera los 20 MB." };
  }
  let tables: TableLine[][];
  try {
    tables = await readTables(file, kind);
  } catch {
    return { ok: false, message: "No se pudo leer el archivo." };
  }
  const table = findTableBody(tables, options.isHeader);
  if (table === null) {
    return { ok: false, message: options.missingHeader };
  }
  if (table.lines.length > options.maxLines) {
    return {
      ok: false,
      message: `El archivo supera el máximo de ${options.maxLines.toLocaleString("es-PE")} filas.`,
    };
  }
  return { ok: true, table };
}
