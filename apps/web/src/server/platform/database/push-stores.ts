// Copies the local data directory into a deployed Worker's Durable Objects:
// `LOAD_TOKEN=... bun run stores:push https://host`. Each store moves in
// pages, commits in one swap, then must read back the same rows page by page.
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { databaseConfig } from "~/server/platform/config/env";

import { createBunSqliteStore } from "./bun-store";
import { copyStore, localEnd } from "./store-pages";
import {
  migrationsOf,
  remoteEnd,
  runTransfer,
  transferArgs,
} from "./store-transfer";

// Store names as the Worker's store routes take them.
function localStores(dataDir: string): string[] {
  const workspaces = readdirSync(join(dataDir, "workspaces"))
    .filter((file) => file.endsWith(".sqlite"))
    .map((file) => `workspaces/${file.slice(0, -".sqlite".length)}`);
  return ["registry", "platform", ...workspaces.toSorted()];
}

async function pushStore(
  base: string,
  token: string,
  dataDir: string,
  name: string,
): Promise<void> {
  const store = createBunSqliteStore(join(dataDir, `${name}.sqlite`));
  try {
    const { rows } = await copyStore(
      localEnd(store, migrationsOf(name)),
      remoteEnd(base, token, name),
    );
    console.log(`${name}: ${rows} rows`);
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const { base, token } = transferArgs("stores:push");
  const { dataDir } = databaseConfig();
  for (const name of localStores(dataDir)) {
    // Each store commits on its own; order does not matter, and one at a time
    // keeps a failure's report to one store.
    // eslint-disable-next-line no-await-in-loop
    await pushStore(base, token, dataDir, name);
  }
}

if (import.meta.main) {
  runTransfer(main);
}
