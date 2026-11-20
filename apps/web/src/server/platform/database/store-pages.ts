import { decodeBase64, encodeBase64 } from "@oslojs/encoding";

import { isPlainRecord } from "~/shared/type-guards";

import { insertBatches } from "./batches";
import type { SqliteRow, SqliteStore, SqliteValue } from "./store";

// A store moves between a local file and its Durable Object in pages, because
// an object holds 128 MB of memory and a request carries 100 MB: a workspace
// with an imported history outgrows both as one dump. Pages land in stage
// tables inside the receiving store, and one commit swaps them in.

type Migrations = readonly (readonly string[])[];

// The schema version and each table's row count. The receiving end commits
// only when its stage holds exactly these counts.
export interface StoreManifest {
  version: number;
  tables: Record<string, number>;
}

// Rows of one table in key order. `after` is the last row's key, from which
// the next page starts; null when the table has no more rows.
export interface StorePage {
  rows: SqliteRow[];
  after: SqliteValue[] | null;
}

// One end of a copy: a local store, or a deployed object over HTTP.
export interface StoreEnd {
  manifest(): Promise<StoreManifest>;
  page(table: string, after: SqliteValue[] | null): Promise<StorePage>;
  clearStage(): Promise<void>;
  stage(table: string, rows: SqliteRow[]): Promise<void>;
  commit(manifest: StoreManifest): Promise<{ rows: number }>;
}

// Large enough to keep a 250 MB store near sixty requests, small enough that
// a page and its encoding fit an object's memory many times over.
const PAGE_BYTES = 4_000_000;
const PAGE_ROWS = 1000;
const STAGE_PREFIX = "_stage_";

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

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

// A table's columns without its generated ones, which SQLite computes and
// refuses to be given. `pragma_table_info` lists only the stored columns.
function storedColumns(store: SqliteStore, table: string): string[] {
  return store
    .exec("select name from pragma_table_info(?) order by cid", [table])
    .rows.map((row) => quote(String(row.name)));
}

// Pages walk the primary key's index, so no page sorts the table. Every data
// table declares one.
function keyColumns(store: SqliteStore, table: string): string[] {
  const key = store
    .exec("select name from pragma_table_info(?) where pk > 0 order by pk", [
      table,
    ])
    .rows.map((row) => String(row.name));
  if (key.length === 0) {
    throw new Error(`load_table_without_key: ${table}`);
  }
  return key;
}

function checkTable(
  store: SqliteStore,
  migrations: Migrations,
  table: string,
): void {
  if (!dataTables(store, migrations).includes(table)) {
    throw new Error(`load_unknown_table: ${table}`);
  }
}

function count(store: SqliteStore, table: string): number {
  const [row] = store.exec(
    `select count(*) as n from ${quote(table)}`,
    [],
  ).rows;
  return Number(row?.n ?? 0);
}

export function storeManifest(
  store: SqliteStore,
  migrations: Migrations,
): StoreManifest {
  const tables: Record<string, number> = {};
  for (const table of dataTables(store, migrations)) {
    tables[table] = count(store, table);
  }
  return { version: schemaVersion(store), tables };
}

export function readPage(
  store: SqliteStore,
  migrations: Migrations,
  table: string,
  after: SqliteValue[] | null,
  maxBytes = PAGE_BYTES,
): StorePage {
  checkTable(store, migrations, table);
  const columns = storedColumns(store, table);
  const names = keyColumns(store, table);
  const key = names.map(quote);
  const select = `select ${columns.join(", ")} from ${quote(table)}`;
  const rows: SqliteRow[] = [];
  let bytes = 0;
  let last = after;
  for (;;) {
    const where = last
      ? ` where (${key.join(", ")}) > (${key.map(() => "?").join(", ")})`
      : "";
    const batch = store.exec(
      `${select}${where} order by ${key.join(", ")} limit ${PAGE_ROWS}`,
      (last ?? []).map(sqliteValue),
    ).rows;
    for (const row of batch) {
      last = names.map((name) => sqliteValue(row[name]));
      rows.push(row);
      bytes += encodeTransfer(row).length;
      if (bytes >= maxBytes) {
        return { rows, after: last };
      }
    }
    if (batch.length < PAGE_ROWS) {
      return { rows, after: null };
    }
  }
}

const stageName = (table: string) => `${STAGE_PREFIX}${table}`;
const stageOf = (table: string) => quote(stageName(table));

// The stage copies the table's stored columns and their affinities, so a
// staged value compares equal to the same value in the table.
function ensureStage(store: SqliteStore, table: string): void {
  store.exec(
    `create table if not exists ${stageOf(table)} as select ${storedColumns(store, table).join(", ")} from ${quote(table)} where 0`,
    [],
  );
}

export function clearStage(store: SqliteStore): void {
  const staged = store.exec(
    "select name from sqlite_master where type = 'table' and substr(name, 1, ?) = ?",
    [STAGE_PREFIX.length, STAGE_PREFIX],
  ).rows;
  for (const row of staged) {
    store.exec(`drop table ${quote(String(row.name))}`, []);
  }
}

// One transaction per page: on a file store each batch would otherwise sync
// to disk on its own, and a page holds hundreds of batches.
export async function stageRows(
  store: SqliteStore,
  migrations: Migrations,
  table: string,
  rows: readonly SqliteRow[],
): Promise<void> {
  checkTable(store, migrations, table);
  await store.transaction(async () => {
    ensureStage(store, table);
    for (const batch of insertBatches(rows)) {
      insertRows(store, stageOf(table), batch);
    }
  });
}

// Makes the store hold exactly the staged rows, in one transaction. The stage
// must hold every row of the manifest, from the same schema version. Outside
// the tables the migrations fill, a store row the stage does not hold refuses
// the commit, so it never overwrites a store in use, and committing the same
// rows again changes nothing. Foreign keys are checked at commit, so tables
// stage in any order. A refused commit drops the stage, so a failed push
// leaves no copy of the rows behind.
export async function commitStage(
  store: SqliteStore,
  migrations: Migrations,
  manifest: StoreManifest,
): Promise<{ rows: number }> {
  try {
    checkStage(store, migrations, manifest);
  } catch (error) {
    clearStage(store);
    throw error;
  }
  const tables = dataTables(store, migrations);
  let rows = 0;
  await store.transaction(async () => {
    store.exec("pragma defer_foreign_keys = on", []);
    // Every table is cleared before any is filled, so a cascading delete
    // cannot reach a loaded row.
    for (const table of tables) {
      store.exec(`delete from ${quote(table)}`, []);
    }
    for (const table of tables) {
      const columns = storedColumns(store, table).join(", ");
      rows += store.exec(
        `insert into ${quote(table)} (${columns}) select ${columns} from ${stageOf(table)}`,
        [],
      ).changes;
    }
    clearStage(store);
  });
  return { rows };
}

function checkStage(
  store: SqliteStore,
  migrations: Migrations,
  manifest: StoreManifest,
): void {
  const version = schemaVersion(store);
  if (manifest.version !== version) {
    throw new Error(`load_version_mismatch: ${manifest.version} <> ${version}`);
  }
  const tables = dataTables(store, migrations);
  for (const table of Object.keys(manifest.tables)) {
    checkTable(store, migrations, table);
  }
  for (const table of tables) {
    ensureStage(store, table);
    const staged = count(store, stageName(table));
    const expected = manifest.tables[table] ?? 0;
    if (staged !== expected) {
      throw new Error(`load_incomplete: ${table} ${staged} <> ${expected}`);
    }
  }
  const replaceable = migrationFilledTables(migrations);
  for (const table of tables.filter((t) => !replaceable.has(t))) {
    const columns = storedColumns(store, table).join(", ");
    const [dropped] = store.exec(
      `select 1 from (select ${columns} from ${quote(table)} except select ${columns} from ${stageOf(table)}) limit 1`,
      [],
    ).rows;
    if (dropped) {
      throw new Error(`load_would_drop_rows: ${table}`);
    }
  }
}

interface LocalEndOptions {
  // Runs once the rows are in, for an object to compose itself again over
  // them.
  committed?: () => Promise<void>;
  pageBytes?: number;
}

export function localEnd(
  store: SqliteStore,
  migrations: Migrations,
  { committed = async () => {}, pageBytes = PAGE_BYTES }: LocalEndOptions = {},
): StoreEnd {
  return {
    manifest: async () => storeManifest(store, migrations),
    page: async (table, after) =>
      readPage(store, migrations, table, after, pageBytes),
    clearStage: async () => clearStage(store),
    stage: async (table, rows) => stageRows(store, migrations, table, rows),
    commit: async (manifest) => {
      const result = await commitStage(store, migrations, manifest);
      await committed();
      return result;
    },
  };
}

// An end reached through `call`, which carries one encoded operation to
// `serveTransfer` on the other side and returns its encoded result.
export function transportEnd(
  call: (operation: string, body: string) => Promise<string>,
): StoreEnd {
  const send = async (operation: string, body: unknown) =>
    decodeTransfer(await call(operation, encodeTransfer(body)));
  return {
    manifest: async () => manifestOf(await send("manifest", {})),
    page: async (table, after) => pageOf(await send("page", { table, after })),
    clearStage: async () => {
      await send("clear", {});
    },
    stage: async (table, rows) => {
      await send("stage", { table, rows });
    },
    commit: async (manifest) => {
      const { rows } = field(await send("commit", manifest), ["rows"]);
      return { rows: Number(rows) };
    },
  };
}

// Copies every row of `from` into `to`, then reads both ends page by page and
// fails unless they hold the same rows.
export async function copyStore(
  from: StoreEnd,
  to: StoreEnd,
): Promise<{ rows: number }> {
  const manifest = await from.manifest();
  await to.clearStage();
  for (const table of Object.keys(manifest.tables)) {
    // eslint-disable-next-line no-await-in-loop
    for await (const page of pages(from, table)) {
      // eslint-disable-next-line no-await-in-loop
      await to.stage(table, page.rows);
    }
  }
  const committed = await to.commit(manifest);
  for (const table of Object.keys(manifest.tables)) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await sameRows(from, to, table))) {
      throw new Error(`load_mismatch: ${table}`);
    }
  }
  return committed;
}

async function* pages(end: StoreEnd, table: string): AsyncGenerator<StorePage> {
  let after: SqliteValue[] | null = null;
  do {
    // eslint-disable-next-line no-await-in-loop
    const page: StorePage = await end.page(table, after);
    yield page;
    after = page.after;
  } while (after);
}

async function* rowsIn(end: StoreEnd, table: string): AsyncGenerator<string> {
  for await (const page of pages(end, table)) {
    for (const row of page.rows) {
      yield encodeTransfer(row);
    }
  }
}

// Both ends list a table's rows in key order, so equal stores yield equal
// sequences whatever size each end cuts its pages.
async function sameRows(
  a: StoreEnd,
  b: StoreEnd,
  table: string,
): Promise<boolean> {
  const theirs = rowsIn(b, table);
  for await (const row of rowsIn(a, table)) {
    // eslint-disable-next-line no-await-in-loop
    const other = await theirs.next();
    if (other.done || other.value !== row) {
      return false;
    }
  }
  return (await theirs.next()).done === true;
}

// Runs one transfer operation against an end. Bodies and results are
// `encodeTransfer` text.
export async function serveTransfer(
  end: StoreEnd,
  operation: string,
  body: string,
): Promise<string> {
  const input = body ? decodeTransfer(body) : null;
  switch (operation) {
    case "manifest":
      return encodeTransfer(await end.manifest());
    case "page": {
      const { table, after } = field(input, ["table", "after"]);
      return encodeTransfer(
        await end.page(String(table), after === null ? null : values(after)),
      );
    }
    case "clear":
      await end.clearStage();
      return encodeTransfer({});
    case "stage": {
      const { table, rows } = field(input, ["table", "rows"]);
      await end.stage(String(table), rowsOf(rows));
      return encodeTransfer({});
    }
    case "commit":
      return encodeTransfer(await end.commit(manifestOf(input)));
    default:
      throw new Error(`load_unknown_operation: ${operation}`);
  }
}

function field<K extends string>(
  value: unknown,
  keys: readonly K[],
): Record<K, unknown> {
  if (!isPlainRecord(value)) {
    throw new Error("load_invalid_body");
  }
  for (const key of keys) {
    if (!(key in value)) {
      throw new Error(`load_invalid_body: ${key}`);
    }
  }
  return value;
}

function values(value: unknown): SqliteValue[] {
  if (!Array.isArray(value)) {
    throw new Error("load_invalid_body: after");
  }
  return value.map(sqliteValue);
}

function rowsOf(value: unknown): SqliteRow[] {
  if (!Array.isArray(value)) {
    throw new Error("load_invalid_body: rows");
  }
  return value.map((row: unknown) => {
    if (!isPlainRecord(row)) {
      throw new Error("load_invalid_body: rows");
    }
    return row;
  });
}

function manifestOf(value: unknown): StoreManifest {
  const { version, tables } = field(value, ["version", "tables"]);
  if (typeof version !== "number" || !isPlainRecord(tables)) {
    throw new Error("load_invalid_manifest");
  }
  const counts: Record<string, number> = {};
  for (const [table, rows] of Object.entries(tables)) {
    if (typeof rows !== "number") {
      throw new Error("load_invalid_manifest");
    }
    counts[table] = rows;
  }
  return { version, tables: counts };
}

function pageOf(value: unknown): StorePage {
  const { rows, after } = field(value, ["rows", "after"]);
  return { rows: rowsOf(rows), after: after === null ? null : values(after) };
}

function insertRows(
  store: SqliteStore,
  quotedTable: string,
  batch: readonly SqliteRow[],
): number {
  const columns = [...new Set(batch.flatMap((row) => Object.keys(row)))];
  if (columns.length === 0) {
    return 0;
  }
  const placeholders = `(${columns.map(() => "?").join(", ")})`;
  return store.exec(
    `insert into ${quotedTable} (${columns.map(quote).join(", ")}) values ${batch.map(() => placeholders).join(", ")}`,
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

// JSON with byte columns as `{ "$bytes": base64 }`, so rows cross HTTP
// unchanged.
export function encodeTransfer(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item instanceof Uint8Array ? { $bytes: encodeBase64(item) } : item,
  );
}

export function decodeTransfer(text: string): unknown {
  return JSON.parse(text, (_key, item: unknown) => {
    if (typeof item !== "object" || item === null) {
      return item;
    }
    if ("$bytes" in item && typeof item.$bytes === "string") {
      return decodeBase64(item.$bytes);
    }
    return item;
  });
}
