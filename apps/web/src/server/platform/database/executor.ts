import type { Kysely, Transaction } from "kysely";

import type {
  PlatformDatabase,
  RegistryDatabase,
  WorkspaceDatabase,
} from "~/server/platform/database/types";

export type Executor<DB> = Kysely<DB> | Transaction<DB>;

export type WorkspaceExecutor = Executor<WorkspaceDatabase>;
export type PlatformExecutor = Executor<PlatformDatabase>;
export type RegistryExecutor = Executor<RegistryDatabase>;

// Kysely types isTransaction as `boolean` on Kysely and `true` on Transaction,
// not as a discriminant, so `if (db.isTransaction)` alone does not narrow.
export function isTransactionExecutor<DB>(
  db: Executor<DB>,
): db is Transaction<DB> {
  return db.isTransaction;
}
