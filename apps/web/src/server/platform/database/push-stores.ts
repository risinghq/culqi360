// Copies the local data directory into a deployed Worker's Durable Objects:
// `LOAD_TOKEN=... bun run stores:push https://host`. Each store's dump goes to
// its object, then the object's dump must match the local one byte for byte.
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { databaseConfig } from "~/server/platform/config/env";

import { createBunSqliteStore } from "./bun-store";
import { dumpStore, encodeDump } from "./load";
import { PLATFORM_MIGRATIONS } from "./schema/platform";
import { REGISTRY_MIGRATIONS } from "./schema/registry";
import { WORKSPACE_MIGRATIONS } from "./schema/workspace";

// Store names as the Worker's store routes take them.
function localStores(dataDir: string): string[] {
  const workspaces = readdirSync(join(dataDir, "workspaces"))
    .filter((file) => file.endsWith(".sqlite"))
    .map((file) => `workspaces/${file.slice(0, -".sqlite".length)}`);
  return ["registry", "platform", ...workspaces.toSorted()];
}

function migrationsOf(name: string) {
  if (name === "platform") {
    return PLATFORM_MIGRATIONS;
  }
  return name === "registry" ? REGISTRY_MIGRATIONS : WORKSPACE_MIGRATIONS;
}

function localDump(dataDir: string, name: string): string {
  const store = createBunSqliteStore(join(dataDir, `${name}.sqlite`));
  try {
    return encodeDump(dumpStore(store, migrationsOf(name)));
  } finally {
    store.close();
  }
}

async function send(
  url: string,
  token: string,
  init: RequestInit,
): Promise<string> {
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method} ${url}: ${response.status} ${body}`);
  }
  return body;
}

async function pushStore(
  base: string,
  token: string,
  dataDir: string,
  name: string,
): Promise<void> {
  const dump = localDump(dataDir, name);
  const url = new URL(`/api/admin/stores/${name}`, base).toString();
  const loaded = await send(url, token, { method: "PUT", body: dump });
  if ((await send(url, token, { method: "GET" })) !== dump) {
    throw new Error(`${name}: the deployed store differs from the local one`);
  }
  console.log(`${name}: ${loaded}`);
}

async function main(): Promise<void> {
  const [base] = process.argv.slice(2);
  const token = process.env.LOAD_TOKEN;
  if (!base || !token) {
    throw new Error("usage: LOAD_TOKEN=... bun run stores:push <worker-url>");
  }
  const { dataDir } = databaseConfig();
  for (const name of localStores(dataDir)) {
    // Each store loads in its own transaction; order does not matter, and one
    // at a time keeps a failure's report to one store.
    // eslint-disable-next-line no-await-in-loop
    await pushStore(base, token, dataDir, name);
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
