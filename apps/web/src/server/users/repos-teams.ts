import type { BranchId, TeamId } from "~/domain/ids";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";

export function createTeamsRepo(db: WorkspaceExecutor) {
  return {
    findByBranch(branchId: BranchId) {
      return db
        .selectFrom("teams")
        .selectAll()
        .where("branch_id", "=", branchId)
        .orderBy("name", "asc")
        .execute();
    },

    findById(id: TeamId) {
      return db
        .selectFrom("teams")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
    },
  };
}

export type TeamsRepo = ReturnType<typeof createTeamsRepo>;
