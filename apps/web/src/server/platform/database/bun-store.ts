import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  checkDurableObjectLimits,
  type SqliteResult,
  type SqliteRow,
  type SqliteStore,
  type StoreOpener,
} from "./store";

// Every store as one SQLite file under a directory.
export function fileStores(dataDir: string): StoreOpener {
  mkdirSync(join(dataDir, "workspaces"), { recursive: true });
  return (name) => createBunSqliteStore(join(dataDir, `${name}.sqlite`));
}

// An in-process database for tests and local tools. Foreign keys are on, as
// they are in a Durable Object.
export function createBunSqliteStore(path = ":memory:"): SqliteStore & {
  close(): void;
} {
  const db = openBunDatabase(new Database(path, { strict: true }));
  return { ...bunSqliteStore(() => db), close: () => db.close() };
}

export function openBunDatabase(db: Database): Database {
  db.exec("pragma foreign_keys = on");
  return db;
}

// A store over whichever database `current` returns, so a test can swap in a
// fresh copy without rebuilding the Kysely instances built on the store.
export function bunSqliteStore(current: () => Database): SqliteStore {
  return {
    exec(sql, parameters): SqliteResult {
      checkDurableObjectLimits(sql, parameters);
      const db = current();
      const statement = db.query<SqliteRow, SQLQueryBindings[]>(sql);

      if (statement.columnNames.length > 0) {
        const rows = statement.all(...parameters);
        const changes = db.query<{ c: number }, []>("select changes() as c");
        return { rows, changes: changes.get()?.c ?? 0 };
      }
      return { rows: [], changes: statement.run(...parameters).changes };
    },

    async transaction(work) {
      const db = current();
      db.exec("begin");
      try {
        const value = await work();
        db.exec("commit");
        return value;
      } catch (error) {
        db.exec("rollback");
        throw error;
      }
    },
  };
}
