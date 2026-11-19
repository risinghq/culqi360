import type { Kysely } from "kysely";

import { type BranchId, type UserId, newRowId } from "~/domain/ids";
import type { WorkspaceDatabase } from "~/server/platform/database/types";

export function createBranchSupervisorsRepo(db: Kysely<WorkspaceDatabase>) {
  return {
    async findByBranch(branchId: BranchId) {
      return db
        .selectFrom("branch_supervisors")
        .innerJoin("members", "members.user_id", "branch_supervisors.user_id")
        .select([
          "branch_supervisors.id",
          "branch_supervisors.user_id",
          "members.names",
        ])
        .where("branch_supervisors.branch_id", "=", branchId)
        .orderBy("branch_supervisors.id", "asc")
        .execute();
    },

    async findByUserId(userId: UserId) {
      return db
        .selectFrom("branch_supervisors")
        .select(["branch_id"])
        .where("user_id", "=", userId)
        .execute();
    },

    async assign(branchId: BranchId, userId: UserId, assignedAt: Date) {
      await db
        .insertInto("branch_supervisors")
        .values({
          id: newRowId(),
          branch_id: branchId,
          user_id: userId,
          created_at: assignedAt,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    },

    async isSupervisor(branchId: BranchId, userId: UserId): Promise<boolean> {
      const row = await db
        .selectFrom("branch_supervisors")
        .select(["id"])
        .where("branch_id", "=", branchId)
        .where("user_id", "=", userId)
        .executeTakeFirst();

      return !!row;
    },
  };
}

export type BranchSupervisorsRepo = ReturnType<
  typeof createBranchSupervisorsRepo
>;
