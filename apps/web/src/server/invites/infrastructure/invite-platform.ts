import type { Kysely } from "kysely";

import {
  generateInviteToken,
  hashInviteToken,
} from "~/domain/auth/invite/tokens";
import type { PlatformDatabase } from "~/server/platform/database/types";
import {
  createUserInvitesRepo,
  type InviteRow,
} from "~/server/users/repos-user-invites";

import type { InvitePlatformPort, PendingInvite } from "../application/types";

function toPendingInvite(row: InviteRow): PendingInvite {
  return {
    inviteId: row.id,
    email: row.email,
    names: row.names,
    firstSurname: row.first_surname,
    secondSurname: row.second_surname,
    branchId: row.branch_id,
    teamId: row.team_id,
    roleId: row.role_id,
    executiveCategory: row.executive_category,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    createdByUserId: row.created_by_account_id,
    lastDeliveredAt: row.last_delivered_at,
  };
}

export function createInvitePlatform(
  db: Kysely<PlatformDatabase>,
): InvitePlatformPort {
  const invites = createUserInvitesRepo(db);

  return {
    issue(workspaceId, input, issuedAt) {
      const token = generateInviteToken();
      return db.transaction().execute(async (tx) => {
        const txInvites = createUserInvitesRepo(tx);
        await txInvites.revokePendingByEmail(
          workspaceId,
          input.email,
          issuedAt,
        );
        const inviteId = await txInvites.create({
          workspace_id: workspaceId,
          email: input.email,
          names: input.names,
          first_surname: input.firstSurname,
          second_surname: input.secondSurname,
          branch_id: input.branchId,
          team_id: input.teamId,
          role_id: input.roleId,
          executive_category: input.executiveCategory,
          token_hash: hashInviteToken(token),
          expires_at: input.expiresAt,
          created_by_account_id: input.createdByUserId,
          created_at: issuedAt,
        });
        return { inviteId, token, expiresAt: input.expiresAt };
      });
    },

    async listPending(workspaceId, branchId, activeAsOf) {
      const rows = await invites.listPendingByBranch(
        workspaceId,
        branchId,
        activeAsOf,
      );
      return rows.map(toPendingInvite);
    },

    async findPending(workspaceId, inviteId, activeAsOf) {
      const row = await invites.findById(workspaceId, inviteId);
      if (!row || row.status !== "pending" || row.expires_at <= activeAsOf) {
        return null;
      }
      return toPendingInvite(row);
    },

    async findPendingByEmail(workspaceId, email, activeAsOf) {
      const row = await invites.findPendingByEmail(
        workspaceId,
        email,
        activeAsOf,
      );
      return row ? toPendingInvite(row) : null;
    },

    async rotate(workspaceId, inviteId, expiresAt) {
      const token = generateInviteToken();
      const rotated = await invites.rotateToken(workspaceId, inviteId, {
        token_hash: hashInviteToken(token),
        expires_at: expiresAt,
      });
      return rotated ? token : null;
    },

    revoke(workspaceId, inviteId, revokedAt) {
      return invites.revoke(workspaceId, inviteId, revokedAt);
    },

    markDelivered(workspaceId, inviteId, deliveredAt) {
      return invites.markDelivered(workspaceId, inviteId, deliveredAt);
    },
  };
}
