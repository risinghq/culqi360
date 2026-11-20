import { normalizeCsvHeader } from "./csv";

/** One line of an imported file as text cells, numbered as the user's
 * spreadsheet or editor numbers it. */
export type TableLine = { line: number; cells: string[] };

/** The lines below a file's header row, with the header's normalized
 * columns. Blank lines are dropped. */
export type TableBody = { columns: string[]; lines: TableLine[] };

export function normalizeColumn(raw: string): string {
  return normalizeCsvHeader(raw.replace(/^﻿/, ""));
}

function isBlank(line: TableLine): boolean {
  return line.cells.every((cell) => cell.trim() === "");
}

// The header is the first line the predicate accepts, so a title or notes
// above the table are skipped. The first candidate table with a header wins:
// a CSV is offered once per delimiter, a workbook once per sheet.
export function findTableBody(
  candidates: readonly (readonly TableLine[])[],
  isHeader: (columns: readonly string[]) => boolean,
): TableBody | null {
  for (const lines of candidates) {
    for (const [index, { cells }] of lines.entries()) {
      const columns = cells.map(normalizeColumn);
      if (isHeader(columns)) {
        return {
          columns,
          lines: lines.slice(index + 1).filter((line) => !isBlank(line)),
        };
      }
    }
  }
  return null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isTableLine(value: unknown): value is TableLine {
  if (
    typeof value !== "object" ||
    value === null ||
    !("line" in value) ||
    !("cells" in value)
  ) {
    return false;
  }
  const { line, cells } = value;
  return (
    typeof line === "number" &&
    Number.isInteger(line) &&
    line > 0 &&
    isStringArray(cells)
  );
}

/** Reads the `table` field of a server function's input, or null when it is
 * missing, malformed or holds more than `maxLines` lines. */
export function readTableBody(
  input: unknown,
  maxLines: number,
): TableBody | null {
  if (typeof input !== "object" || input === null || !("table" in input)) {
    return null;
  }
  const value = input.table;
  if (
    typeof value !== "object" ||
    value === null ||
    !("columns" in value) ||
    !("lines" in value)
  ) {
    return null;
  }
  const { columns, lines } = value;
  if (
    !isStringArray(columns) ||
    !Array.isArray(lines) ||
    lines.length > maxLines ||
    !lines.every(isTableLine)
  ) {
    return null;
  }
  return { columns, lines };
}
