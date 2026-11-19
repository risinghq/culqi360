import { DatabaseSync } from "node:sqlite";

import {
  checkDurableObjectLimits,
  type SqliteRow,
  type SqliteStore,
  type StoreOpener,
} from "~/server/platform/database/store";

// Benches run on Node, whose V8 is the engine workerd runs, so the SQLite
// store here is `node:sqlite` rather than `bun:sqlite`.
function nodeSqliteStore(db: DatabaseSync): SqliteStore {
  const statements = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
  const prepare = (sql: string) => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };

  return {
    exec(sql, parameters) {
      checkDurableObjectLimits(sql, parameters);
      const statement = prepare(sql);
      if (statement.columns().length > 0) {
        const rows: SqliteRow[] = statement.all(...parameters);
        const changes = prepare("select changes() as c").get();
        return { rows, changes: Number(changes?.c ?? 0) };
      }
      return {
        rows: [],
        changes: Number(statement.run(...parameters).changes),
      };
    },

    async transaction(work) {
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

// Every store in memory. Opening a name again returns a new store over the
// same database, as a Durable Object wakes over the storage it left.
// Foreign keys are on, as they are in a Durable Object.
export function nodeMemoryStores(): StoreOpener {
  const databases = new Map<string, DatabaseSync>();
  return (name) => {
    let db = databases.get(name);
    if (!db) {
      db = new DatabaseSync(":memory:");
      db.exec("pragma foreign_keys = on");
      databases.set(name, db);
    }
    return nodeSqliteStore(db);
  };
}
