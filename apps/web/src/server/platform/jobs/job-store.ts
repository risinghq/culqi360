import { sql, type Kysely } from "kysely";

import type {
  RegistryExecutor,
  WorkspaceExecutor,
} from "~/server/platform/database/executor";

import { CLAIMABLE_STATES, type JobTableName } from "./registry";

export type DomainPatch = Record<
  string,
  string | number | boolean | Date | null
>;

interface QueueControlColumns {
  id: string | number;
  queue_state: string;
  claimable_at: Date;
  attempt_count: number;
  max_attempts: number;
  error_message: string | null;
  completed_at: Date | null;
}

type QueueControlDb = Record<JobTableName, QueueControlColumns>;

// `attempt` is the attempt_count the claim returned. It fences the job: a
// reclaim increments it, so a holder whose lease expired can no longer extend
// or settle the job.
export interface JobStore<TId extends string | number, TRow> {
  claim(claimedAt: Date, limit: number, leaseMs: number): Promise<TRow[]>;

  extendLease(
    id: TId,
    attempt: number,
    leaseMs: number,
    renewedAt: Date,
  ): Promise<boolean>;

  markDone(
    id: TId,
    attempt: number,
    completedAt: Date,
    patch?: DomainPatch,
  ): Promise<boolean>;

  scheduleRetry(
    id: TId,
    attempt: number,
    claimableAt: Date,
    reason: string | null,
    patch?: DomainPatch,
  ): Promise<boolean>;

  markFailed(
    id: TId,
    attempt: number,
    failedAt: Date,
    reason: string,
    patch?: DomainPatch,
  ): Promise<boolean>;

  countOutstanding(): Promise<number>;
}

export function createJobStore<
  TRow,
  TId extends string | number = string | number,
>(
  executor: WorkspaceExecutor | RegistryExecutor,
  table: JobTableName,
  selectColumns: readonly string[],
): JobStore<TId, TRow> {
  // The table is chosen at runtime, so cast to the shared queue columns.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const db = executor as unknown as Kysely<QueueControlDb>;

  async function updateHeld(
    id: TId,
    attempt: number,
    patch: DomainPatch,
  ): Promise<boolean> {
    const result = await db
      .updateTable(table)
      .set(patch)
      .where("id", "=", id)
      .where("attempt_count", "=", attempt)
      .where("queue_state", "=", "processing")
      .executeTakeFirst();

    return Number(result.numUpdatedRows ?? 0) > 0;
  }

  return {
    async claim(claimedAt, limit, leaseMs) {
      const rows = await db
        .updateTable(table)
        .set((eb) => ({
          queue_state: "processing",
          claimable_at: new Date(claimedAt.getTime() + leaseMs),
          attempt_count: eb("attempt_count", "+", 1),
          error_message: null,
        }))
        .where("id", "in", (qb) =>
          qb
            .selectFrom(table)
            .select("id")
            .where(CLAIMABLE_STATES)
            .where("claimable_at", "<=", claimedAt)
            // Prevent a crash loop from reclaiming the same poison job forever.
            .whereRef("attempt_count", "<", "max_attempts")
            .orderBy("claimable_at", "asc")
            .limit(limit),
        )
        // oxlint-disable-next-line no-unsafe-type-assertion
        .returning(selectColumns as never[])
        .execute();

      // oxlint-disable-next-line no-unsafe-type-assertion
      return rows as TRow[];
    },

    extendLease(id, attempt, leaseMs, renewedAt) {
      return updateHeld(id, attempt, {
        claimable_at: new Date(renewedAt.getTime() + leaseMs),
      });
    },

    markDone(id, attempt, completedAt, patch) {
      return updateHeld(id, attempt, {
        queue_state: "done",
        completed_at: completedAt,
        error_message: null,
        ...patch,
      });
    },

    scheduleRetry(id, attempt, claimableAt, reason, patch) {
      return updateHeld(id, attempt, {
        queue_state: "pending",
        claimable_at: claimableAt,
        error_message: reason,
        ...patch,
      });
    },

    markFailed(id, attempt, failedAt, reason, patch) {
      return updateHeld(id, attempt, {
        queue_state: "failed",
        completed_at: failedAt,
        error_message: reason,
        ...patch,
      });
    },

    // The states are literals because SQLite uses a partial index only when
    // the query names its condition itself; a bound parameter could hold
    // anything, so the claim index would go unused and every job be read.
    async countOutstanding() {
      const row = await db
        .selectFrom(table)
        .select((eb) => eb.fn.count<number>("id").as("count"))
        .where("queue_state", "in", [sql.lit("pending"), sql.lit("processing")])
        .executeTakeFirstOrThrow();

      return row.count;
    },
  };
}
