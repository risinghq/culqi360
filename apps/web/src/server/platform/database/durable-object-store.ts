import type { SqliteRow, SqliteStore } from "./store";

// The part of a Durable Object's `ctx.storage` the store uses. Declared here
// so the server code type-checks without the Workers runtime types.
export type DurableObjectStorageLike = {
  sql: {
    exec(
      query: string,
      ...bindings: unknown[]
    ): { toArray(): SqliteRow[]; readonly rowsWritten: number };
  };
  transaction<T>(work: () => Promise<T>): Promise<T>;
};

export function createDurableObjectStore(
  storage: DurableObjectStorageLike,
): SqliteStore {
  return {
    exec(sql, parameters) {
      const cursor = storage.sql.exec(sql, ...parameters);
      const rows = cursor.toArray();

      // `rowsWritten` also counts index writes, so it is not the row count a
      // caller checks. `changes()` is.
      if (cursor.rowsWritten === 0) {
        return { rows, changes: 0 };
      }
      const [counted] = storage.sql.exec("select changes() as c").toArray();
      return { rows, changes: Number(counted?.c ?? 0) };
    },

    transaction(work) {
      return storage.transaction(work);
    },
  };
}
