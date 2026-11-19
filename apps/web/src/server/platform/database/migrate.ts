import type { SqliteStore } from "./store";

// A store records how many migrations it has run. A Durable Object refuses
// `pragma user_version`, so the count lives in a table. The pending
// migrations run in one transaction, so a store is either current or as it
// was.
export async function applyMigrations(
  store: SqliteStore,
  migrations: readonly (readonly string[])[],
): Promise<void> {
  store.exec(
    "create table if not exists schema_version (version integer not null)",
    [],
  );
  const [row] = store.exec("select version from schema_version", []).rows;
  const pending = migrations.slice(row === undefined ? 0 : Number(row.version));
  if (pending.length === 0) {
    return;
  }

  await store.transaction(async () => {
    for (const statement of pending.flat()) {
      store.exec(statement, []);
    }
    store.exec("delete from schema_version", []);
    store.exec("insert into schema_version (version) values (?)", [
      migrations.length,
    ]);
  });
}
