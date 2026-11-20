// Copies a deployed Worker's Durable Objects into an empty local data
// directory: `LOAD_TOKEN=... bun run stores:pull https://host`. A local
// command such as the safeapp cutover then writes to the copy, and
// `stores:push` sends it back. The push refuses a store that gained rows
// since the pull, so a copy never overwrites newer writes.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { databaseConfig } from "~/server/platform/config/env";

import { createBunSqliteStore } from "./bun-store";
import { decodeDump, dumpStore, encodeDump, loadStore } from "./load";
import { applyMigrations } from "./migrate";
import {
  migrationsOf,
  runTransfer,
  send,
  storeUrl,
  transferArgs,
} from "./store-transfer";

// The platform store lists every workspace, so it names the stores to pull.
function workspaceStores(platformDump: string): string[] {
  const rows = decodeDump(platformDump).tables.workspaces ?? [];
  return rows.map((row) => `workspaces/${String(row.id)}`).toSorted();
}

async function writeLocal(
  dataDir: string,
  name: string,
  text: string,
): Promise<number> {
  const migrations = migrationsOf(name);
  const store = createBunSqliteStore(join(dataDir, `${name}.sqlite`));
  try {
    await applyMigrations(store, migrations);
    const { rows } = await loadStore(store, migrations, decodeDump(text));
    if (encodeDump(dumpStore(store, migrations)) !== text) {
      throw new Error(
        `${name}: the local copy differs from the deployed store`,
      );
    }
    return rows;
  } finally {
    store.close();
  }
}

async function pullStore(
  base: string,
  token: string,
  dataDir: string,
  name: string,
): Promise<string> {
  const text = await send(storeUrl(base, name), token, { method: "GET" });
  const rows = await writeLocal(dataDir, name, text);
  console.log(`${name}: {"rows":${rows}}`);
  return text;
}

async function main(): Promise<void> {
  const { base, token } = transferArgs("stores:pull");
  const { dataDir } = databaseConfig();
  // `stores:push` sends every local store, so a stray local workspace would
  // reach production.
  if (existsSync(join(dataDir, "platform.sqlite"))) {
    throw new Error(`${dataDir} already holds stores; pull into an empty one`);
  }
  mkdirSync(join(dataDir, "workspaces"), { recursive: true });
  const platform = await pullStore(base, token, dataDir, "platform");
  for (const name of ["registry", ...workspaceStores(platform)]) {
    // One store at a time keeps a failure's report to one store.
    // eslint-disable-next-line no-await-in-loop
    await pullStore(base, token, dataDir, name);
  }
}

if (import.meta.main) {
  runTransfer(main);
}
