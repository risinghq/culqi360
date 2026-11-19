import type { WorkspaceId } from "~/domain/ids";

export type SqliteRow = Record<string, unknown>;

// What every store binds: the driver encodes dates, booleans and JSON first.
export type SqliteValue = string | number | bigint | Uint8Array | null;

export type SqliteResult = {
  rows: SqliteRow[];
  changes: number;
};

// One SQLite database: a workspace or platform Durable Object in the Worker,
// an in-process database in tests. Statements run synchronously, so a query
// never yields to another request between its start and its result.
export interface SqliteStore {
  exec(sql: string, parameters: readonly SqliteValue[]): SqliteResult;
  // Commits when `work` resolves and rolls back when it rejects. A Durable
  // Object refuses BEGIN through `sql.exec`, so the store owns the boundary.
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

// Names one store: "platform", "registry", or "workspaces/<id>".
export type StoreOpener = (name: string) => SqliteStore;

export const workspaceStoreName = (workspaceId: WorkspaceId) =>
  `workspaces/${workspaceId}`;

// A SQLite Durable Object refuses a statement over these limits. The local
// stores check them too, so a test fails where production would.
export const DURABLE_OBJECT_MAX_BINDINGS = 100;
const DURABLE_OBJECT_MAX_STATEMENT_BYTES = 100_000;

export function checkDurableObjectLimits(
  sql: string,
  parameters: readonly unknown[],
): void {
  if (parameters.length > DURABLE_OBJECT_MAX_BINDINGS) {
    throw new Error(
      `sqlite_too_many_bindings: ${parameters.length} > ${DURABLE_OBJECT_MAX_BINDINGS} in ${sql.slice(0, 120)}`,
    );
  }
  // A UTF-16 unit encodes to at most 3 UTF-8 bytes, so short statements skip
  // the encode.
  if (sql.length * 3 > DURABLE_OBJECT_MAX_STATEMENT_BYTES) {
    const bytes = new TextEncoder().encode(sql).length;
    if (bytes > DURABLE_OBJECT_MAX_STATEMENT_BYTES) {
      throw new Error(`sqlite_statement_too_long: ${bytes} bytes`);
    }
  }
}
