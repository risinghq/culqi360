import {
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type Kysely,
  type QueryResult,
} from "kysely";

import { selectionSources } from "./codec";
import type { CommitEffects } from "./commit-effects";
import type { SqliteRow, SqliteStore, SqliteValue } from "./store";

export type RowDecoder = (
  row: SqliteRow,
  sources?: ReadonlyMap<string, string | null>,
) => SqliteRow;

// SQLite binds numbers, strings, bigints, blobs and null. Dates travel as
// ISO-8601 UTC text, which sorts in time order; booleans as 0 or 1; arrays and
// objects as JSON text.
export function encodeParameter(value: unknown): SqliteValue {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  throw new Error(`sqlite_unbindable_parameter: ${typeof value}`);
}

function isWrite(query: CompiledQuery): boolean {
  const kind = query.query.kind;
  return (
    kind === "InsertQueryNode" ||
    kind === "UpdateQueryNode" ||
    kind === "DeleteQueryNode"
  );
}

class StoreConnection implements DatabaseConnection {
  constructor(
    private readonly store: SqliteStore,
    private readonly decode: RowDecoder,
  ) {}

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const result = this.store.exec(
      query.sql,
      query.parameters.map(encodeParameter),
    );
    const sources =
      result.rows.length > 0 ? selectionSources(query.query) : undefined;
    // Kysely names R from the query it compiled; the decoder gives each column
    // the type the schema declares for it.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const rows = result.rows.map((row) => this.decode(row, sources)) as R[];

    if (!isWrite(query)) {
      return { rows };
    }
    return { rows, numAffectedRows: BigInt(result.changes) };
  }

  // oxlint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("sqlite_store_does_not_stream");
  }
}

type OpenTransaction = {
  finish(outcome: "commit" | "rollback"): Promise<void>;
};

const ROLLBACK = Symbol("sqlite_store_rollback");

// Kysely drives a transaction as begin, queries, commit or rollback. The store
// takes it as one closure, so begin opens a closure that waits for the outcome.
// `ready` must be called from inside the closure: in a Durable Object, a timer
// or event that the transaction awaits must start in the closure's context, or
// the object holds it until the transaction ends and deadlocks. Resolving
// begin from inside puts the rest of Kysely's transaction body in that context.
function openTransaction(store: SqliteStore): Promise<OpenTransaction> {
  return new Promise((ready, failed) => {
    let settle!: (outcome: "commit" | "rollback") => void;
    const outcome = new Promise<"commit" | "rollback">((resolve) => {
      settle = resolve;
    });

    const done = store
      .transaction(async () => {
        ready({
          async finish(result) {
            settle(result);
            await done;
          },
        });
        if ((await outcome) === "rollback") {
          throw ROLLBACK;
        }
      })
      .catch((error: unknown) => {
        if (error !== ROLLBACK) {
          failed(error);
          throw error;
        }
      });
  });
}

// One store has one connection. Kysely acquires it per query or per
// transaction, so the lock keeps a query from landing inside another
// request's open transaction. A Durable Object's `storage.transaction` does
// not hold back other requests, so every query of a store must go through one
// driver. The lock also stalls the whole workspace while a transaction awaits,
// so a transaction body makes no network calls.
class SqliteStoreDriver implements Driver {
  private readonly connection: StoreConnection;
  private held: Promise<void> = Promise.resolve();
  private release: (() => void) | undefined;
  private open: OpenTransaction | undefined;

  constructor(
    private readonly store: SqliteStore,
    decode: RowDecoder,
    private readonly effects: CommitEffects | undefined,
  ) {
    this.connection = new StoreConnection(store, decode);
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    const previous = this.held;
    let release!: () => void;
    this.held = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    this.release = release;
    return this.connection;
  }

  async releaseConnection(): Promise<void> {
    const release = this.release;
    this.release = undefined;
    release?.();
  }

  async beginTransaction(): Promise<void> {
    this.open = await openTransaction(this.store);
    this.effects?.begin();
  }

  async commitTransaction(): Promise<void> {
    try {
      await this.finish("commit");
    } catch (error: unknown) {
      this.effects?.rollback();
      throw error;
    }
    this.effects?.commit();
  }

  async rollbackTransaction(): Promise<void> {
    this.effects?.rollback();
    await this.finish("rollback");
  }

  async destroy(): Promise<void> {}

  private async finish(outcome: "commit" | "rollback"): Promise<void> {
    const open = this.open;
    this.open = undefined;
    if (!open) {
      throw new Error("sqlite_store_no_open_transaction");
    }
    await open.finish(outcome);
  }
}

export function createSqliteStoreDialect(
  store: SqliteStore,
  decode: RowDecoder,
  effects?: CommitEffects,
): Dialect {
  return {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new SqliteStoreDriver(store, decode, effects),
    createIntrospector: (db: Kysely<any>) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  };
}
