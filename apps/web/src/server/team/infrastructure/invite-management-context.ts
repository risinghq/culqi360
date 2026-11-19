import type { Kysely } from "kysely";

import type { WorkspaceInviteService } from "~/server/invites/application/types";
import type { WorkspaceDatabase } from "~/server/platform/database/types";
import { createRolesRepo } from "~/server/roles/repos-roles";
import { createTeamsRepo } from "~/server/users/repos-teams";

import type { InviteManagementQueryPort } from "../application/ports";

export function createInviteManagementContext(
  db: Kysely<WorkspaceDatabase>,
  inviteService: Pick<WorkspaceInviteService, "listPendingInvites">,
): InviteManagementQueryPort {
  const teams = createTeamsRepo(db);
  const roles = createRolesRepo(db);

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
