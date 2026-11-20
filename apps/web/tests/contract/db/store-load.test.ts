import { describe, expect, it } from "vitest";

import type { WorkspaceId } from "~/domain/ids";
import { createBunSqliteStore } from "~/server/platform/database/bun-store";
import {
  decodeDump,
  dumpStore,
  encodeDump,
  loadStore,
} from "~/server/platform/database/load";
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
  await seedIfEmpty({
    platform: await add("platform", openPlatformStore, PLATFORM_MIGRATIONS),
    registry: await add("registry", openRegistryStore, REGISTRY_MIGRATIONS),
    workspace: (id: WorkspaceId) =>
      add(`workspaces/${id}`, openWorkspaceStore, WORKSPACE_MIGRATIONS),
  });
  return stores;
}

describe("store load", () => {
  it("rebuilds every seeded store from its dump", async () => {
    const stores = await seededStores();
    expect(stores.size).toBeGreaterThan(3);

    for (const [name, { store, open, migrations }] of stores) {
      const dump = decodeDump(encodeDump(dumpStore(store, migrations)));
      const fresh = createBunSqliteStore();
      // eslint-disable-next-line no-await-in-loop
      await open(fresh);
      // eslint-disable-next-line no-await-in-loop
      const { rows } = await loadStore(fresh, migrations, dump);

      // `stores:push` checks a deployed store by this equality.
      expect({ name, dump: encodeDump(dumpStore(fresh, migrations)) }).toEqual({
        name,
        dump: encodeDump(dumpStore(store, migrations)),
      });
      if (name.startsWith("workspaces/")) {
        // The search index is not dumped; the triggers rebuild it, and the
        // check throws when it disagrees with its content table.
        fresh.exec(
          "insert into organizations_search (organizations_search) values ('integrity-check')",
          [],
        );
      }
      expect({ name, rows }).toEqual({
        name,
        rows: Object.values(dump.tables).reduce((sum, t) => sum + t.length, 0),
      });
    }
  });

  it("loads the same dump again without a change", async () => {
    const platform = (await seededStores()).get("platform");
    if (!platform) {
      throw new Error("no platform store");
    }
    const dump = dumpStore(platform.store, PLATFORM_MIGRATIONS);

    await loadStore(platform.store, PLATFORM_MIGRATIONS, dump);

    expect(dumpStore(platform.store, PLATFORM_MIGRATIONS)).toEqual(dump);
  });

  it("refuses to drop a row the dump does not hold", async () => {
    const platform = (await seededStores()).get("platform");
    if (!platform) {
      throw new Error("no platform store");
    }
    const dump = dumpStore(platform.store, PLATFORM_MIGRATIONS);
    const accounts = dump.tables.accounts ?? [];
    expect(accounts.length).toBeGreaterThan(0);

    await expect(
      loadStore(platform.store, PLATFORM_MIGRATIONS, {
        ...dump,
        tables: { ...dump.tables, accounts: accounts.slice(1) },
      }),
    ).rejects.toThrow("load_would_drop_rows: accounts");
    expect(dumpStore(platform.store, PLATFORM_MIGRATIONS)).toEqual(dump);
  });

  it("refuses a dump from another schema version", async () => {
    const fresh = createBunSqliteStore();
    await openPlatformStore(fresh);
    const dump = dumpStore(fresh, PLATFORM_MIGRATIONS);

    await expect(
      loadStore(fresh, PLATFORM_MIGRATIONS, {
        ...dump,
        version: dump.version + 1,
      }),
    ).rejects.toThrow("load_version_mismatch");
  });

  it("refuses a table the store does not have", async () => {
    const fresh = createBunSqliteStore();
    await openPlatformStore(fresh);
    const dump = dumpStore(fresh, PLATFORM_MIGRATIONS);

    await expect(
      loadStore(fresh, PLATFORM_MIGRATIONS, {
        ...dump,
        tables: { missing: [] },
      }),
    ).rejects.toThrow("load_unknown_table: missing");
  });

  it("keeps byte values across the JSON transport", () => {
    const dump = {
      version: 1,
      tables: { t: [{ id: 1, data: new Uint8Array([0, 255, 7]) }] },
    };

    expect(decodeDump(encodeDump(dump))).toEqual(dump);
  });
});
