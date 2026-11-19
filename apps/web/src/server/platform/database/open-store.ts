import { Kysely } from "kysely";

import { createRowDecoder, readColumnKinds } from "./codec";
import { CommitEffects } from "./commit-effects";
import { createSqliteStoreDialect } from "./driver";
import { applyMigrations } from "./migrate";
import { PLATFORM_MIGRATIONS } from "./schema/platform";
import { REGISTRY_MIGRATIONS } from "./schema/registry";
import { WORKSPACE_MIGRATIONS } from "./schema/workspace";
import type { SqliteStore } from "./store";
import type {
  PlatformDatabase,
  RegistryDatabase,
  WorkspaceDatabase,
} from "./types";

// A store and the effects its commits release: realtime messages, and the
// re-arm of the store's alarm after a write that may bring a deadline closer.
export interface OpenedStore<DB> {
  db: Kysely<DB>;
  effects: CommitEffects;
}

// Migrates the store, then reads its column kinds once: the decoder maps
// columns by name, so it must see the schema the migrations left.
async function openStore<DB>(
  store: SqliteStore,
  migrations: readonly (readonly string[])[],
): Promise<OpenedStore<DB>> {
  await applyMigrations(store, migrations);
  const decode = createRowDecoder(readColumnKinds(store));
  const effects = new CommitEffects();
  const db = new Kysely<DB>({
    dialect: createSqliteStoreDialect(store, decode, effects),
  });
  return { db, effects };
}

export function openPlatformStore(
  store: SqliteStore,
): Promise<OpenedStore<PlatformDatabase>> {
  return openStore(store, PLATFORM_MIGRATIONS);
}

export function openRegistryStore(
  store: SqliteStore,
): Promise<OpenedStore<RegistryDatabase>> {
  return openStore(store, REGISTRY_MIGRATIONS);
}

export type OpenedWorkspaceStore = OpenedStore<WorkspaceDatabase>;

export function openWorkspaceStore(
  store: SqliteStore,
): Promise<OpenedWorkspaceStore> {
  return openStore(store, WORKSPACE_MIGRATIONS);
}
