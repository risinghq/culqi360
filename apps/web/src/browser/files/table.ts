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

type Xlsx = typeof import("xlsx");
type Cell = import("xlsx").CellObject;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

// A cell's value as text, independent of the sheet's display format: a date
// becomes ISO yyyy-mm-dd (with the time when it has one), because the
// display text is locale-shaped (`1/5/24`), and a number keeps its full
// precision. A number shown zero-padded (a DNI formatted `00000000`) keeps
// the padded digits.
function valueText(XLSX: Xlsx, cell: Cell | undefined): string {
  if (cell === undefined || cell.v === undefined) {
    return "";
  }
  if (cell.t === "n" && typeof cell.v === "number") {
    if (cell.z !== undefined && XLSX.SSF.is_date(cell.z)) {
      const date = XLSX.SSF.parse_date_code(cell.v);
      const day = `${pad(date.y, 4)}-${pad(date.m)}-${pad(date.d)}`;
      return date.H + date.M + date.S === 0
        ? day
        : `${day}T${pad(date.H)}:${pad(date.M)}:${pad(date.S)}`;
    }
    const plain = String(cell.v);
    const shown = cell.w ?? "";
    return /^\d+$/.test(shown) && shown.length > plain.length ? shown : plain;
  }
  if (cell.t === "e") {
    return "";
  }
  if (cell.v instanceof Date) {
    return cell.v.toISOString();
  }
  return cell.t === "b" ? (cell.v ? "TRUE" : "FALSE") : String(cell.v);
}

async function workbookTables(bytes: ArrayBuffer): Promise<TableLine[][]> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(bytes, { type: "array", cellNF: true });
  return workbook.SheetNames.flatMap((name) => {
    const sheet = workbook.Sheets[name];
    if (sheet?.["!ref"] === undefined) {
      return [];
    }
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const lines: TableLine[] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cells: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell: Cell | undefined = sheet[XLSX.utils.encode_cell({ r, c })];
        cells.push(valueText(XLSX, cell));
      }
      lines.push({ line: r + 1, cells });
    }
    return [lines];
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
