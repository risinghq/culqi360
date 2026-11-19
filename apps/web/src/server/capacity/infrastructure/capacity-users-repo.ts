import type { Selectable } from "kysely";

import type { BranchId, UserId } from "~/domain/ids";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { MembersTable } from "~/server/platform/database/types";

import type { CapacityUser } from "../application/actor-scope";

type UserRow = Selectable<MembersTable>;

function toCapacityUser(user: UserRow): CapacityUser {
  return {
    id: user.user_id,
    role: user.role,
    branchId: user.branch_id,
    teamId: user.team_id,
    email: user.email,
    names: user.names,
    firstSurname: user.first_surname,
    secondSurname: user.second_surname,
    executiveCategory: user.executive_category,
  };
}

export function createCapacityUsersRepo(db: WorkspaceExecutor) {
  return {
    findById(id: UserId) {
      return db
        .selectFrom("members")
        .selectAll()
        .where("user_id", "=", id)
        .executeTakeFirst()
        .then((user) => (user ? toCapacityUser(user) : undefined));
    },

    findByBranchIncludingInactive(branchId: BranchId) {
      return db
        .selectFrom("members")
        .selectAll()
        .where("branch_id", "=", branchId)
        .execute()
        .then((users) => users.map(toCapacityUser));
    },

    findByBranch(branchId: BranchId) {
      return db
        .selectFrom("members")
        .selectAll()
        .where("branch_id", "=", branchId)
        .where("is_active", "=", true)
        .execute()
        .then((users) => users.map(toCapacityUser));
    },

    findAllActive() {
      return db
        .selectFrom("members")
        .selectAll()
        .where("is_active", "=", true)
        .execute()
        .then((users) => users.map(toCapacityUser));
    },
  };
}

export type CapacityUsersRepo = ReturnType<typeof createCapacityUsersRepo>;
