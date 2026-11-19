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

// Migrates the store, then reads its column kinds once: the decoder maps
// columns by name, so it must see the schema the migrations left.
async function openStore<DB>(
  store: SqliteStore,
  migrations: readonly (readonly string[])[],
  effects?: CommitEffects,
): Promise<Kysely<DB>> {
  await applyMigrations(store, migrations);
  const decode = createRowDecoder(readColumnKinds(store));
  return new Kysely<DB>({
    dialect: createSqliteStoreDialect(store, decode, effects),
  });
}

export function openPlatformStore(
  store: SqliteStore,
): Promise<Kysely<PlatformDatabase>> {
  return openStore(store, PLATFORM_MIGRATIONS);
}

export function openRegistryStore(
  store: SqliteStore,
): Promise<Kysely<RegistryDatabase>> {
  return openStore(store, REGISTRY_MIGRATIONS);
}

export interface OpenedWorkspaceStore {
  db: Kysely<WorkspaceDatabase>;
  effects: CommitEffects;
}

// A workspace store publishes realtime messages, so it carries the effects
// its commits release.
export async function openWorkspaceStore(
  store: SqliteStore,
): Promise<OpenedWorkspaceStore> {
  const effects = new CommitEffects();
  const db = await openStore<WorkspaceDatabase>(
    store,
    WORKSPACE_MIGRATIONS,
    effects,
  );
  return { db, effects };
}
