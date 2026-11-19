import { shortName } from "~/domain/identity/display-name";
import type { UserId } from "~/domain/ids";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import { createMembersRepo } from "~/server/users/repos-members";

import type { AssignableExecutivesScope } from "../domain/policy";

export type LeadUser = {
  id: UserId;
  isActive: boolean;
};

export type LeadUserWithName = {
  id: UserId;
  fullName: string;
};

export type WorkflowUserRepository = {
  findById(id: UserId): Promise<LeadUser | undefined>;
  findByIds(ids: UserId[]): Promise<LeadUserWithName[]>;
  isExecutiveAssignable(
    scope: AssignableExecutivesScope,
    executiveId: UserId,
  ): Promise<boolean>;
  listAssignableExecutives(
    input: AssignableExecutivesScope,
    options?: { search?: string; limit?: number },
  ): Promise<LeadUserWithName[]>;
};

export function createWorkflowUsersRepo(
  executor: WorkspaceExecutor,
): WorkflowUserRepository {
  const users = createMembersRepo(executor);

  return {
    async findById(id) {
      const user = await users.findById(id);
      if (!user) {
        return undefined;
      }

      return {
        id: user.user_id,
        isActive: user.is_active,
      };
    },
    async findByIds(ids): Promise<LeadUserWithName[]> {
      const rows = await users.findByIds(ids);
      return rows.map((user) => ({
        id: user.user_id,
        fullName: shortName(user),
      }));
    },
    async isExecutiveAssignable(
      scope: AssignableExecutivesScope,
      executiveId: UserId,
    ): Promise<boolean> {
      const user = await users.findById(executiveId);
      if (!user) {
        return false;
      }

      if (user.role !== "executive") {
        return false;
      }
      if (!user.is_active || user.onboarding_completed_at == null) {
        return false;
      }
      if (
        scope.actorRole !== "superuser" &&
        user.branch_id !== scope.actorBranchId
      ) {
        return false;
      }

      return true;
    },
    async listAssignableExecutives(
      input: AssignableExecutivesScope,
      options?: { search?: string; limit?: number },
    ): Promise<LeadUserWithName[]> {
      const limit = options?.limit && options.limit > 0 ? options.limit : 50;
      const rows = await users.findAssignableExecutives({
        branchId:
          input.actorRole === "superuser" ? undefined : input.actorBranchId,
        search: options?.search,
        limit,
      });

      return rows.map((user) => ({
        id: user.user_id,
        fullName: shortName(user),
      }));
    },
  };
}
