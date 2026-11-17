import type { Kysely } from "kysely";

import type { CapacityReservationId, UserId } from "~/domain/ids";
import type { InstantRange } from "~/domain/time/app-time";
import type { CapacityKind } from "~/server/capacity/domain/usage-types";
import type { Database } from "~/server/platform/database/types";

type SettledStatus = "committed" | "cancelled" | "expired";

export function createCapacityGrantsRepo(
  db: Kysely<Database>,
  kind: CapacityKind,
) {
  return {
    async insert(values: {
      user_id: UserId;
      amount: number;
      reason: string;
      actor_user_id: UserId;
      created_at: Date;
    }): Promise<void> {
      await db
        .insertInto("capacity_grants")
        .values({ ...values, kind })
        .executeTakeFirstOrThrow();
    },

    findByUserAndRange(userId: UserId, range: InstantRange) {
      return db
        .selectFrom("capacity_grants")
        .selectAll()
        .where("kind", "=", kind)
        .where("user_id", "=", userId)
        .where("created_at", ">=", range.start)
        .where("created_at", "<", range.endExclusive)
        .execute();
    },
  };
}

export function createCapacityReservationsRepo(
  db: Kysely<Database>,
  kind: CapacityKind,
) {
  return {
    insert(values: {
      user_id: UserId;
      amount: number;
      reason: string;
      created_at: Date;
      updated_at: Date;
    }) {
      return db
        .insertInto("capacity_reservations")
        .values({ ...values, kind, status: "pending" })
        .returning("id")
        .executeTakeFirstOrThrow();
    },

    findById(id: CapacityReservationId) {
      return db
        .selectFrom("capacity_reservations")
        .selectAll()
        .where("kind", "=", kind)
        .where("id", "=", id)
        .executeTakeFirst();
    },

    async updateStatus(
      id: CapacityReservationId,
      status: SettledStatus,
      updatedAt: Date,
    ): Promise<void> {
      await db
        .updateTable("capacity_reservations")
        .set({ status, updated_at: updatedAt })
        .where("kind", "=", kind)
        .where("id", "=", id)
        .executeTakeFirst();
    },

    async updateAmountAndStatus(
      id: CapacityReservationId,
      amount: number,
      status: SettledStatus,
      updatedAt: Date,
    ): Promise<void> {
      await db
        .updateTable("capacity_reservations")
        .set({ amount, status, updated_at: updatedAt })
        .where("kind", "=", kind)
        .where("id", "=", id)
        .executeTakeFirst();
    },

    findByUserAndRange(userId: UserId, range: InstantRange) {
      return db
        .selectFrom("capacity_reservations")
        .selectAll()
        .where("kind", "=", kind)
        .where("user_id", "=", userId)
        .where("created_at", ">=", range.start)
        .where("created_at", "<", range.endExclusive)
        .execute();
    },
  };
}

// A commit carries no kind of its own: it belongs to its reservation's kind.
export function createCapacityCommitsRepo(
  db: Kysely<Database>,
  kind: CapacityKind,
) {
  return {
    async insert(values: {
      reservation_id: CapacityReservationId;
      amount: number;
      created_at: Date;
    }): Promise<void> {
      await db
        .insertInto("capacity_commits")
        .values(values)
        .executeTakeFirstOrThrow();
    },

    findByReservation(reservationId: CapacityReservationId) {
      return db
        .selectFrom("capacity_commits")
        .selectAll()
        .where("reservation_id", "=", reservationId)
        .execute();
    },

    findByUserAndRange(userId: UserId, range: InstantRange) {
      return db
        .selectFrom("capacity_commits as c")
        .innerJoin("capacity_reservations as r", "r.id", "c.reservation_id")
        .select(["c.id", "c.reservation_id", "c.amount", "c.created_at"])
        .where("r.kind", "=", kind)
        .where("r.user_id", "=", userId)
        .where("c.created_at", ">=", range.start)
        .where("c.created_at", "<", range.endExclusive)
        .execute();
    },
  };
}

export type CapacityGrantsRepo = ReturnType<typeof createCapacityGrantsRepo>;
export type CapacityReservationsRepo = ReturnType<
  typeof createCapacityReservationsRepo
>;
export type CapacityCommitsRepo = ReturnType<typeof createCapacityCommitsRepo>;
