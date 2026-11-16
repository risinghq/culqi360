import { read, utils } from "xlsx";

import { fail, type DomainError } from "~/domain/errors";
import { normalizeCsvHeader, parseCsvRows } from "~/server/csv/core";
import { Err, Ok, type Result } from "~/shared/result";

import type { CampaignImportRow } from "../domain/import-rows";

export const MAX_CAMPAIGN_FILE_ROWS = 100_000;

const RUC_COLUMN = "ruc";
const LEGAL_NAME_COLUMN = "razon_social";

type FileLine = { line: number; cells: string[] };

export type CampaignFileOptions = {
  extension: "csv" | "xlsx";
  // Each client names its pool column differently: safeapp's file groups by
  // `origen`. The import names it rather than the parser guessing.
  segmentColumn: string;
};

function normalizeHeader(raw: string): string {
  return normalizeCsvHeader(raw.replace(/^﻿/, ""));
}

function csvLines(bytes: Uint8Array, delimiter: "," | ";"): FileLine[] {
  const text = new TextDecoder("utf-8").decode(bytes);
  return parseCsvRows(text, delimiter).map((row) => ({
    line: row.rowNumber,
    cells: row.cells,
  }));
}

function xlsxLines(bytes: Uint8Array): FileLine[] {
  const workbook = read(bytes, { type: "array" });
  const name = workbook.SheetNames[0];
  const sheet = name === undefined ? undefined : workbook.Sheets[name];
  if (sheet === undefined) {
    return [];
  }
  const firstRow = utils.decode_range(sheet["!ref"] ?? "A1").s.r;
  const rows = utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: true,
  });
  return rows.map((cells, index) => ({
    line: firstRow + index + 1,
    cells: cells.map(String),
  }));
}

type Header = { index: number; columns: string[] };

// The header is the first line that names both the RUC and the segment
// column, so a title or notes above the table are skipped.
function findHeader(
  lines: readonly FileLine[],
  segment: string,
): Header | null {
  for (const [index, { cells }] of lines.entries()) {
    const columns = cells.map((cell) => normalizeHeader(cell));
    if (columns.includes(RUC_COLUMN) && columns.includes(segment)) {
      return { index, columns };
    }
  }
  return null;
}

// Every column other than RUC, legal name and segment becomes a fact, keyed
// by its normalized header.
function toRow(
  columns: readonly string[],
  segment: string,
  line: FileLine,
): CampaignImportRow {
  const values: Record<string, string> = {};
  for (const [i, column] of columns.entries()) {
    if (column !== "") {
      values[column] = line.cells[i] ?? "";
    }
  }
  const {
    [RUC_COLUMN]: ruc,
    [LEGAL_NAME_COLUMN]: legalName,
    [segment]: segmentValue,
    ...facts
  } = values;
  return { line: line.line, ruc, legalName, segment: segmentValue, facts };
}

function readHeaderAndRows(
  bytes: Uint8Array,
  options: CampaignFileOptions,
  segment: string,
): { lines: FileLine[]; header: Header } | null {
  const candidates =
    options.extension === "xlsx"
      ? [() => xlsxLines(bytes)]
      : [() => csvLines(bytes, ","), () => csvLines(bytes, ";")];
  for (const load of candidates) {
    const lines = load();
    const header = findHeader(lines, segment);
    if (header !== null) {
      return { lines, header };
    }
  }
  return null;
}

export function parseCampaignFile(
  bytes: Uint8Array,
  options: CampaignFileOptions,
): Result<CampaignImportRow[], DomainError> {
  const segment = normalizeHeader(options.segmentColumn);
  const table = readHeaderAndRows(bytes, options, segment);
  if (table === null) {
    return Err(fail("campaign_file_columns_missing"));
  }
  const { lines, header } = table;
  const body = lines
    .slice(header.index + 1)
    .filter((line) => line.cells.some((cell) => cell.trim() !== ""));
  if (body.length > MAX_CAMPAIGN_FILE_ROWS) {
    return Err(fail("campaign_file_too_large"));
  }
  return Ok(body.map((line) => toRow(header.columns, segment, line)));
}
