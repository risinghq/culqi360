import { createInviteServiceForExecutor } from "~/server/invites/infrastructure/invite-service-factory";
import type { DatabaseExecutor } from "~/server/platform/database/executor";
import { createRolesRepo } from "~/server/roles/repos-roles";
import { createTeamsRepo } from "~/server/users/repos-teams";

import type { InviteManagementQueryPort } from "../application/ports";

export function createInviteManagementContext(
  executor: DatabaseExecutor,
): InviteManagementQueryPort {
  const inviteService = createInviteServiceForExecutor(executor);
  const teams = createTeamsRepo(executor);
  const roles = createRolesRepo(executor);

  return {
    async listTeamsByBranch(branchId) {
      const rows = await teams.findByBranch(branchId);
      return rows.map((team) => ({ id: team.id, name: team.name }));
    },
    listPendingInvites(branchId, operation) {
      return inviteService.listPendingInvites(branchId, operation);
    },
    listRoles() {
      return roles.list();
    },
  };
}
