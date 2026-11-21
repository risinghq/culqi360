// One-time import of the old culqi360 deploy into work360's Culqi workspace:
// `CULQI360_DATABASE_URL=postgres://... bun run cutover:culqi360 [--write]`.
// The workspace already exists, seeded with the culqi module; the import
// fills it. Prints counts only: the rows hold Culqi's customers' data.
import { parseArgs } from "node:util";

import { SQL } from "bun";

import { databaseConfig } from "~/server/platform/config/env";
import { fileStores } from "~/server/platform/database/bun-store";
import type { SqliteStore } from "~/server/platform/database/store";

import { readPostgresSnapshot, type SourceRow } from "../shared/postgres";
import { insertRows, targetRows, type TargetRows } from "./copy";
import {
  accountRows,
  memberRows,
  membershipRows,
  snapshotRows,
  subscriptionRows,
} from "./derived";
import {
  LEFT_BEHIND,
  REGISTRY_TABLES,
  type TableCopy,
  WORKSPACE_TABLES,
} from "./tables";

// Tables read for a derived copy rather than a TableCopy.
const DERIVED_SOURCES = ["users", "gpv_snapshots", "file_assets"];

type Step = { copy: TableCopy; rows: TargetRows };

async function sourceTables(url: string): Promise<string[]> {
  const source = new SQL(url);
  try {
    const rows: { name: string }[] = await source.unsafe(
      "select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1",
    );
    return rows.map((row) => row.name);
  } finally {
    await source.close();
  }
}

// A table with rows that no list names would be lost without notice.
function checkCovered(snapshot: Record<string, readonly SourceRow[]>): void {
  const known = new Set([
    ...WORKSPACE_TABLES.map((copy) => copy.source),
    ...REGISTRY_TABLES.map((copy) => copy.source),
    ...Object.keys(LEFT_BEHIND),
    ...DERIVED_SOURCES,
  ]);
  const unknown = Object.entries(snapshot)
    .filter(([table, rows]) => rows.length > 0 && !known.has(table))
    .map(([table]) => table);
  if (unknown.length > 0) {
    throw new Error(`cutover_unknown_tables:${unknown.join(",")}`);
  }
}

function workspaceOf(platform: SqliteStore, name: string): string {
  const { rows } = platform.exec("select id from workspaces where name = ?", [
    name,
  ]);
  const id = rows[0]?.id;
  if (rows.length !== 1 || typeof id !== "string") {
    throw new Error("cutover_workspace_missing");
  }
  return id;
}

function count(store: SqliteStore, sql: string, parameters: string[] = []) {
  return Number(store.exec(sql, parameters).rows[0]?.n ?? 0);
}

// The seeded workspace holds reference rows, its installation admin and the
// admin's login events, and nothing a Culqi user made.
function checkEmpty(workspace: SqliteStore): void {
  for (const table of ["organizations", "people", "workflow_leads"]) {
    if (count(workspace, `select count(*) as n from "${table}"`) > 0) {
      throw new Error(`cutover_workspace_not_empty:${table}`);
    }
  }
}

function checkAccountsFree(platform: SqliteStore, accounts: TargetRows) {
  const index = (name: string) =>
    accounts.columns.findIndex((column) => column.name === name);
  for (const column of ["id", "username", "email"]) {
    const at = index(column);
    const taken = accounts.values.filter(
      (row) =>
        count(
          platform,
          `select count(*) as n from accounts where lower("${column}") = lower(?)`,
          [String(row[at])],
        ) > 0,
    ).length;
    if (taken > 0) {
      throw new Error(`cutover_${column}_taken:${taken}`);
    }
  }
}

function roleIds(workspace: SqliteStore): Map<string, string> {
  const { rows } = workspace.exec("select key, id from workspace_roles", []);
  return new Map(rows.map((row) => [String(row.key), String(row.id)]));
}

// The seed gave the workspace a branch that the source also has, under another
// id. The source's rows take the seeded id: a load never drops a row, so the
// seeded branch cannot give way.
function seededBranches(
  workspace: SqliteStore,
  sources: readonly SourceRow[],
): Map<string, string> {
  const { rows } = workspace.exec("select id, name from branches", []);
  const byName = new Map(rows.map((row) => [String(row.name), String(row.id)]));
  const ids = new Map<string, string>();
  for (const source of sources) {
    const seeded = byName.get(source.name ?? "");
    if (seeded && source.id) {
      ids.set(source.id, seeded);
    }
  }
  return ids;
}

function remapBranches(
  workspace: SqliteStore,
  { copy, rows }: Step,
  ids: ReadonlyMap<string, string>,
): Step {
  const { rows: keys } = workspace.exec(
    'select "from" as name from pragma_foreign_key_list(?) where "table" = \'branches\'',
    [copy.target],
  );
  const at = new Set(
    keys
      .map((key) =>
        rows.columns.findIndex((column) => column.name === key.name),
      )
      .filter((index) => index >= 0),
  );
  const idAt = rows.columns.findIndex((column) => column.name === "id");
  const values = rows.values
    .filter((row) => copy.target !== "branches" || !ids.has(String(row[idAt])))
    .map((row) =>
      row.map((value, index) =>
        at.has(index) ? (ids.get(String(value)) ?? value) : value,
      ),
    );
  return { copy, rows: { columns: rows.columns, values } };
}

function workspaceSteps(
  workspace: SqliteStore,
  snapshot: Record<string, readonly SourceRow[]>,
): Step[] {
  const rowsOf = (table: string) => snapshot[table] ?? [];
  const branches = seededBranches(workspace, rowsOf("branches"));
  const step = (copy: TableCopy, rows: readonly SourceRow[]): Step =>
    remapBranches(
      workspace,
      { copy, rows: targetRows(workspace, copy, rows) },
      branches,
    );
  const members = step(
    { source: "users", target: "members" },
    memberRows(rowsOf("users"), roleIds(workspace)),
  );
  const snapshots = step(
    { source: "gpv_snapshots", target: "gpv_snapshots" },
    snapshotRows(rowsOf("gpv_snapshots"), rowsOf("file_assets")),
  );
  const copies = WORKSPACE_TABLES.map((copy) =>
    step(copy, rowsOf(copy.source)),
  );
  const placements = copies.findIndex(
    ({ copy }) => copy.target === "gpv_snapshot_placements",
  );
  copies.splice(placements, 0, snapshots);
  return [members, ...copies];
}

function report(steps: readonly Step[], written?: readonly number[]): void {
  for (const [index, { copy, rows }] of steps.entries()) {
    const wrote = written ? ` wrote ${written[index]}` : "";
    console.log(
      `${copy.source} -> ${copy.target}: ${rows.values.length}${wrote}`,
    );
  }
}

// Strict copies must write every row; a merge may keep a seeded one.
async function writeSteps(
  store: SqliteStore,
  steps: readonly Step[],
): Promise<number[]> {
  return store.transaction(async () => {
    // Rows reference each other in cycles, such as a member's team and the
    // team's supervisor; the commit checks every key.
    store.exec("pragma defer_foreign_keys = on", []);
    const written = steps.map((step) =>
      insertRows(store, step.copy, step.rows),
    );
    for (const [index, { copy, rows }] of steps.entries()) {
      if (!copy.onConflict && written[index] !== rows.values.length) {
        throw new Error(`cutover_short_write:${copy.target}`);
      }
    }
    return Promise.resolve(written);
  });
}

async function main(): Promise<void> {
  const url = process.env.CULQI360_DATABASE_URL;
  if (!url) {
    throw new Error("CULQI360_DATABASE_URL is not set");
  }
  const { values } = parseArgs({
    options: {
      workspace: { type: "string", default: "Culqi" },
      write: { type: "boolean", default: false },
    },
  });
  const snapshot = await readPostgresSnapshot(url, await sourceTables(url));
  checkCovered(snapshot);
  for (const [table, reason] of Object.entries(LEFT_BEHIND)) {
    console.log(
      `left behind ${table} (${reason}): ${snapshot[table]?.length ?? 0}`,
    );
  }

  const openStore = fileStores(databaseConfig().dataDir);
  const platform = openStore("platform");
  const registry = openStore("registry");
  const workspaceId = workspaceOf(platform, values.workspace);
  const workspace = openStore(`workspaces/${workspaceId}`);
  checkEmpty(workspace);

  const users = snapshot.users ?? [];
  const records = snapshot.company_registry_record ?? [];
  const workspaceWork = workspaceSteps(workspace, snapshot);
  const registryWork: Step[] = [
    ...REGISTRY_TABLES.map((copy) => ({
      copy,
      rows: targetRows(registry, copy, snapshot[copy.source] ?? []),
    })),
    {
      copy: {
        source: "company_registry_record",
        target: "company_registry_subscriptions",
      },
      rows: targetRows(
        registry,
        {
          source: "company_registry_record",
          target: "company_registry_subscriptions",
        },
        subscriptionRows(records, workspaceId),
      ),
    },
  ];
  const accounts = targetRows(
    platform,
    { source: "users", target: "accounts" },
    accountRows(users),
  );
  const platformWork: Step[] = [
    { copy: { source: "users", target: "accounts" }, rows: accounts },
    {
      copy: { source: "users", target: "memberships" },
      rows: targetRows(
        platform,
        { source: "users", target: "memberships" },
        membershipRows(users, workspaceId),
      ),
    },
  ];
  checkAccountsFree(platform, accounts);

  if (!values.write) {
    report([...workspaceWork, ...registryWork, ...platformWork]);
    console.log("Dry run. Pass --write to fill the workspace.");
    return;
  }
  // Each store commits on its own. A run that fails after the first commit
  // leaves a partial copy: pull the stores again before the next run.
  report(workspaceWork, await writeSteps(workspace, workspaceWork));
  report(registryWork, await writeSteps(registry, registryWork));
  report(platformWork, await writeSteps(platform, platformWork));
  console.log(`Filled workspace ${values.workspace} (${workspaceId}).`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
