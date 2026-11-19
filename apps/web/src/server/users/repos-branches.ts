import type { Kysely } from "kysely";

import type { BranchId } from "~/domain/ids";
import type { WorkspaceDatabase } from "~/server/platform/database/types";

export function createBranchesRepo(db: Kysely<WorkspaceDatabase>) {
  return {
    findById(id: BranchId) {
      return db
        .selectFrom("branches")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
    },

    findAll() {
      return db.selectFrom("branches").selectAll().execute();
    },
  };
}

export type BranchesRepo = ReturnType<typeof createBranchesRepo>;
