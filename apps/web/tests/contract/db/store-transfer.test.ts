import { describe, expect, it } from "vitest";

import type { WorkspaceId } from "~/domain/ids";
import { createBunSqliteStore } from "~/server/platform/database/bun-store";
import {
  openPlatformStore,
  openRegistryStore,
  openWorkspaceStore,
  type OpenedStore,
} from "~/server/platform/database/open-store";
import { PLATFORM_MIGRATIONS } from "~/server/platform/database/schema/platform";
import { REGISTRY_MIGRATIONS } from "~/server/platform/database/schema/registry";
import { WORKSPACE_MIGRATIONS } from "~/server/platform/database/schema/workspace";
import { seedIfEmpty } from "~/server/platform/database/seed";
import type { SqliteStore } from "~/server/platform/database/store";
import {
  copyStore,
  decodeTransfer,
  encodeTransfer,
  localEnd,
  serveTransfer,
  type StoreEnd,
  transportEnd,
} from "~/server/platform/database/store-pages";

type Migrations = readonly (readonly string[])[];

interface Seeded {
  store: SqliteStore;
  open: (store: SqliteStore) => Promise<unknown>;
  migrations: Migrations;
}

// The development seed in local stores, keyed by store name, with what makes
// a fresh store of the same kind.
async function seededStores() {
  const stores = new Map<string, Seeded>();
  const add = async <DB>(
    name: string,
    open: (store: SqliteStore) => Promise<OpenedStore<DB>>,
    migrations: Migrations,
  ) => {
    const store = createBunSqliteStore();
    stores.set(name, { store, open, migrations });
    return (await open(store)).db;
  };
  await seedIfEmpty(
    {
      platform: await add("platform", openPlatformStore, PLATFORM_MIGRATIONS),
      registry: await add("registry", openRegistryStore, REGISTRY_MIGRATIONS),
      workspace: (id: WorkspaceId) =>
        add(`workspaces/${id}`, openWorkspaceStore, WORKSPACE_MIGRATIONS),
    },
    { kind: "development" },
  );
  return stores;
}

async function seededPlatform(): Promise<Seeded> {
  const platform = (await seededStores()).get("platform");
  if (!platform) {
    throw new Error("no platform store");
  }
  return platform;
}

// A store reached through the same encoding as the Worker's routes, cut into
// small pages so every table of the seed spans several.
function wired(store: SqliteStore, migrations: Migrations) {
  const end = localEnd(store, migrations, { pageBytes: 2000 });
  const operations: string[] = [];
  const remote: StoreEnd = transportEnd(async (operation, body) => {
    operations.push(operation);
    return serveTransfer(end, operation, body);
  });
  return { remote, operations };
}

const manifestOf = (store: SqliteStore, migrations: Migrations) =>
  localEnd(store, migrations).manifest();

describe("store transfer", () => {
  it("copies every seeded store into a fresh one page by page", async () => {
    const stores = await seededStores();
    expect(stores.size).toBeGreaterThan(3);

    for (const [name, { store, open, migrations }] of stores) {
      const fresh = createBunSqliteStore();
      // eslint-disable-next-line no-await-in-loop
      await open(fresh);
      const { remote, operations } = wired(store, migrations);
      // eslint-disable-next-line no-await-in-loop
      const manifest = await manifestOf(store, migrations);

      // copyStore reads both stores back and throws unless their rows match.
      // eslint-disable-next-line no-await-in-loop
      const { rows } = await copyStore(remote, localEnd(fresh, migrations));

      expect({ name, rows }).toEqual({
        name,
        rows: Object.values(manifest.tables).reduce((sum, n) => sum + n, 0),
      });
      const pages = operations.filter((operation) => operation === "page");
      expect(pages.length).toBeGreaterThan(Object.keys(manifest.tables).length);
      if (name.startsWith("workspaces/")) {
        // The search index is not copied; the triggers rebuild it, and the
        // check throws when it disagrees with its content table.
        fresh.exec(
          "insert into organizations_search (organizations_search) values ('integrity-check')",
          [],
        );
      }
    }
  });

  it("commits the same rows again without a change", async () => {
    const { store } = await seededPlatform();
    const copy = createBunSqliteStore();
    await openPlatformStore(copy);
    await copyStore(
      localEnd(store, PLATFORM_MIGRATIONS),
      localEnd(copy, PLATFORM_MIGRATIONS),
    );
    const before = await manifestOf(store, PLATFORM_MIGRATIONS);

    await copyStore(
      localEnd(copy, PLATFORM_MIGRATIONS),
      wired(store, PLATFORM_MIGRATIONS).remote,
    );

    expect(await manifestOf(store, PLATFORM_MIGRATIONS)).toEqual(before);
  });

  it("refuses to drop a row the source does not hold", async () => {
    const { store } = await seededPlatform();
    const copy = createBunSqliteStore();
    await openPlatformStore(copy);
    await copyStore(
      localEnd(store, PLATFORM_MIGRATIONS),
      localEnd(copy, PLATFORM_MIGRATIONS),
    );
    copy.exec("pragma foreign_keys = off", []);
    copy.exec(
      "delete from accounts where id = (select min(id) from accounts)",
      [],
    );
    const before = await manifestOf(store, PLATFORM_MIGRATIONS);

    await expect(
      copyStore(
        localEnd(copy, PLATFORM_MIGRATIONS),
        wired(store, PLATFORM_MIGRATIONS).remote,
      ),
    ).rejects.toThrow("load_would_drop_rows: accounts");
    expect(await manifestOf(store, PLATFORM_MIGRATIONS)).toEqual(before);
    expect(
      store.exec(
        "select name from sqlite_master where substr(name, 1, 7) = '_stage_'",
        [],
      ).rows,
    ).toEqual([]);
  });

  it("refuses a manifest from another schema version", async () => {
    const fresh = createBunSqliteStore();
    await openPlatformStore(fresh);
    const end = localEnd(fresh, PLATFORM_MIGRATIONS);
    const manifest = await end.manifest();

    await expect(
      end.commit({ ...manifest, version: manifest.version + 1 }),
    ).rejects.toThrow("load_version_mismatch");
  });

  it("refuses a commit before every row is staged", async () => {
    const fresh = createBunSqliteStore();
    await openPlatformStore(fresh);
    const end = localEnd(fresh, PLATFORM_MIGRATIONS);
    const manifest = await end.manifest();

    await expect(
      end.commit({
        ...manifest,
        tables: { ...manifest.tables, accounts: 1 },
      }),
    ).rejects.toThrow("load_incomplete: accounts 0 <> 1");
  });

  it("refuses a table the store does not have", async () => {
    const fresh = createBunSqliteStore();
    await openPlatformStore(fresh);

    await expect(
      localEnd(fresh, PLATFORM_MIGRATIONS).stage("missing", []),
    ).rejects.toThrow("load_unknown_table: missing");
  });

  it("keeps byte values across the JSON transport", () => {
    const rows = [{ id: 1, data: new Uint8Array([0, 255, 7]) }];

    expect(decodeTransfer(encodeTransfer(rows))).toEqual(rows);
  });
});
