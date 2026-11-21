import {
  DURABLE_OBJECT_MAX_BINDINGS,
  type SqliteStore,
  type SqliteValue,
} from "~/server/platform/database/store";

import type { SourceRow } from "../shared/postgres";
import type { TableCopy } from "./tables";

type Column = { name: string; type: string };

function columnsOf(store: SqliteStore, table: string): Column[] {
  const { rows } = store.exec("select name, type from pragma_table_info(?)", [
    table,
  ]);
  if (rows.length === 0) {
    throw new Error(`cutover_table_missing:${table}`);
  }
  return rows.map((row) => ({
    name: String(row.name),
    type: String(row.type).toLowerCase(),
  }));
}

// Postgres prints a timestamptz as `2026-11-20 13:14:11.36+00`; work360
// stores ISO-8601 text in UTC, as the driver writes a Date.
function isoTime(value: string): string {
  const date = new Date(
    value.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"),
  );
  if (Number.isNaN(date.getTime())) {
    throw new Error("cutover_bad_timestamp");
  }
  return date.toISOString();
}

// Every source value arrives as text. A target column's declared type says
// how the driver would have written it.
function encode(column: Column, value: string | null): SqliteValue {
  if (value === null) {
    return null;
  }
  if (column.type === "timestamptz") {
    return isoTime(value);
  }
  if (column.type === "boolean") {
    return value === "true" ? 1 : 0;
  }
  return value;
}

export type TargetRows = { columns: Column[]; values: SqliteValue[][] };

// The source rows as the target table's columns. A source column the copy
// neither maps nor drops fails the run, so a schema change is never lost.
export function targetRows(
  store: SqliteStore,
  copy: TableCopy,
  rows: readonly SourceRow[],
): TargetRows {
  const byName = new Map(
    columnsOf(store, copy.target).map((column) => [column.name, column]),
  );
  const used: { source: string; column: Column }[] = [];
  const unknown: string[] = [];
  for (const source of Object.keys(rows[0] ?? {})) {
    if (copy.drop?.includes(source)) {
      continue;
    }
    const column = byName.get(copy.rename?.[source] ?? source);
    if (column) {
      used.push({ source, column });
    } else {
      unknown.push(source);
    }
  }
  if (unknown.length > 0) {
    throw new Error(`cutover_unmapped:${copy.source}.${unknown.join(",")}`);
  }
  return {
    columns: used.map(({ column }) => column),
    values: rows.map((row) =>
      used.map(({ source, column }) =>
        copy.clear?.includes(column.name)
          ? null
          : encode(column, row[source] ?? null),
      ),
    ),
  };
}

// Inserts in statements a Durable Object accepts. Returns the rows written.
export function insertRows(
  store: SqliteStore,
  copy: Pick<TableCopy, "target" | "onConflict">,
  rows: TargetRows,
): number {
  const { columns, values } = rows;
  if (values.length === 0) {
    return 0;
  }
  const verb = copy.onConflict === "replace" ? "insert or replace" : "insert";
  const tail = copy.onConflict === "merge" ? " on conflict do nothing" : "";
  const names = columns.map((column) => `"${column.name}"`).join(", ");
  const row = `(${columns.map(() => "?").join(", ")})`;
  const perStatement = Math.floor(DURABLE_OBJECT_MAX_BINDINGS / columns.length);
  let written = 0;
  for (let start = 0; start < values.length; start += perStatement) {
    const batch = values.slice(start, start + perStatement);
    written += store.exec(
      `${verb} into "${copy.target}" (${names}) values ${batch.map(() => row).join(", ")}${tail}`,
      batch.flat(),
    ).changes;
  }
  return written;
}
