import { DURABLE_OBJECT_MAX_BINDINGS } from "./store";

function slices<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
}

// Splits rows so a multi-row insert of one batch stays within the store's
// bound-parameter limit. Kysely binds one parameter for each column any row
// names, so the union of keys sets the width. `reserved` counts parameters
// the statement binds outside its rows.
export function insertBatches<T extends object>(
  rows: readonly T[],
  reserved = 0,
): T[][] {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      columns.add(key);
    }
  }
  const size = Math.floor(
    (DURABLE_OBJECT_MAX_BINDINGS - reserved) / Math.max(columns.size, 1),
  );
  if (size < 1) {
    throw new Error(`insert_row_too_wide: ${columns.size} columns`);
  }
  return slices(rows, size);
}

// Splits the values of an `in (...)` list, leaving `reserved` parameters for
// the rest of the statement.
export function listBatches<T>(values: readonly T[], reserved = 0): T[][] {
  return slices(values, DURABLE_OBJECT_MAX_BINDINGS - reserved);
}
