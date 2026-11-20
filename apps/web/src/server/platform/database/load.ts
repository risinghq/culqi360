import { decodeBase64, encodeBase64 } from "@oslojs/encoding";

import { insertBatches } from "./batches";
import type { SqliteRow, SqliteStore, SqliteValue } from "./store";

// Every row of one store, as SQLite holds it, with the schema version that
// shaped it. Provisioning runs on Bun into local files; a dump carries each
// file to the Durable Object that will hold it.
export interface StoreDump {
  version: number;
  tables: Record<string, SqliteRow[]>;
}

type Migrations = readonly (readonly string[])[];

// Each migration statement is one SQL statement, so a pattern anchored at its
// start never matches a trigger's body.
function statementTables(migrations: Migrations, pattern: RegExp): Set<string> {
  const tables = new Set<string>();
  for (const statement of migrations.flat()) {
    const name = pattern.exec(statement)?.[1];
    if (name) {
      tables.add(name);
    }
  }
  return tables;
}

// The tables the migrations create and that still exist. SQLite's, the
// migrator's and the runtime's own tables are not among them, and neither is
// a virtual table: it indexes a content table, and the content table's
// triggers rebuild it as the rows load.
function dataTables(store: SqliteStore, migrations: Migrations): string[] {
  const created = statementTables(
    migrations,
    /^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?"?(\w+)/i,
  );
  return store
    .exec(
      "select name from sqlite_master where type = 'table' order by name",
      [],
    )
    .rows.map((row) => String(row.name))
    .filter((name) => created.has(name));
}

// The tables a migration fills itself: reference rows every store of the kind
// starts with, which later writes may change.
function migrationFilledTables(migrations: Migrations): Set<string> {
  return statementTables(migrations, /^\s*insert\s+into\s+"?(\w+)/i);
}

function schemaVersion(store: SqliteStore): number {
  const [row] = store.exec("select version from schema_version", []).rows;
  return row === undefined ? 0 : Number(row.version);
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

// A table's rows without its generated columns, which SQLite computes and
// refuses to be given. `pragma_table_info` lists only the stored columns.
// Rows sort by every column, so two stores with the same rows dump the same
// text.
function storedRows(store: SqliteStore, table: string): SqliteRow[] {
  const columns = store
    .exec("select name from pragma_table_info(?) order by cid", [table])
    .rows.map((row) => quote(String(row.name)));
  const order = columns.map((_, index) => index + 1).join(", ");
  return store.exec(
    `select ${columns.join(", ")} from ${quote(table)} order by ${order}`,
    [],
  ).rows;
}

export function dumpStore(
  store: SqliteStore,
  migrations: Migrations,
): StoreDump {
  const tables: Record<string, SqliteRow[]> = {};
  for (const table of dataTables(store, migrations)) {
    tables[table] = storedRows(store, table);
  }
  return { version: schemaVersion(store), tables };
}

// Makes a migrated store hold exactly the dump's rows, in one transaction. The
// dump must come from the same schema version. Outside the tables the
// migrations fill, a store row the dump does not hold refuses the load, so it
// never overwrites a store in use, and loading the same dump again changes
// nothing. Foreign keys are checked at commit, so tables load in any order.
export async function loadStore(
  store: SqliteStore,
  migrations: Migrations,
  dump: StoreDump,
): Promise<{ rows: number }> {
  const version = schemaVersion(store);
  if (dump.version !== version) {
    throw new Error(`load_version_mismatch: ${dump.version} <> ${version}`);
  }
  const tables = dataTables(store, migrations);
  for (const table of Object.keys(dump.tables)) {
    if (!tables.includes(table)) {
      throw new Error(`load_unknown_table: ${table}`);
    }
  }
  const replaceable = migrationFilledTables(migrations);
  for (const table of tables.filter((t) => !replaceable.has(t))) {
    const loaded = new Set((dump.tables[table] ?? []).map(rowKey));
    const held = storedRows(store, table);
    if (!held.every((row) => loaded.has(rowKey(row)))) {
      throw new Error(`load_would_drop_rows: ${table}`);
    }
  }

  let rows = 0;
  await store.transaction(async () => {
    store.exec("pragma defer_foreign_keys = on", []);
    // Every table is cleared before any is filled, so a cascading delete
    // cannot reach a loaded row.
    for (const table of tables) {
      store.exec(`delete from ${quote(table)}`, []);
    }
    for (const table of tables) {
      for (const batch of insertBatches(dump.tables[table] ?? [])) {
        rows += insertRows(store, table, batch);
      }
    }
  });
  return { rows };
}

// Rows of one table share `storedRows`' column order, so the encoded row
// identifies it.
function rowKey(row: SqliteRow): string {
  return JSON.stringify(Object.entries(row), (_key, value: unknown) =>
    value instanceof Uint8Array ? encodeBase64(value) : value,
  );
}

function insertRows(
  store: SqliteStore,
  table: string,
  batch: readonly SqliteRow[],
): number {
  const columns = [...new Set(batch.flatMap((row) => Object.keys(row)))];
  if (columns.length === 0) {
    return 0;
  }
  const placeholders = `(${columns.map(() => "?").join(", ")})`;
  return store.exec(
    `insert into ${quote(table)} (${columns.map(quote).join(", ")}) values ${batch.map(() => placeholders).join(", ")}`,
    batch.flatMap((row) => columns.map((column) => sqliteValue(row[column]))),
  ).changes;
}

function sqliteValue(value: unknown): SqliteValue {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    value instanceof Uint8Array
  ) {
    return value ?? null;
  }
  throw new Error(`load_unsupported_value: ${typeof value}`);
}

// JSON with byte columns as `{ "$bytes": base64 }`, so a dump crosses HTTP
// unchanged.
export function encodeDump(dump: StoreDump): string {
  return JSON.stringify(dump, (_key, value: unknown) =>
    value instanceof Uint8Array ? { $bytes: encodeBase64(value) } : value,
  );
}

export function decodeDump(text: string): StoreDump {
  const parsed: unknown = JSON.parse(text, (_key, value: unknown) =>
    isBytes(value) ? decodeBase64(value.$bytes) : value,
  );
  if (!isDump(parsed)) {
    throw new Error("load_invalid_dump");
  }
  return parsed;
}

function isBytes(value: unknown): value is { $bytes: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "$bytes" in value &&
    typeof value.$bytes === "string"
  );
}

function isDump(value: unknown): value is StoreDump {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    typeof value.version !== "number" ||
    !("tables" in value) ||
    typeof value.tables !== "object" ||
    value.tables === null
  ) {
    return false;
  }
  return Object.values(value.tables).every(
    (rows) =>
      Array.isArray(rows) &&
      rows.every((row) => typeof row === "object" && row !== null),
  );
}
