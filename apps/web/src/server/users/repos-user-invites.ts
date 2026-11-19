import type { Selectable } from "kysely";

import {
  type BranchId,
  UserInviteId,
  type UserId,
  type WorkspaceId,
} from "~/domain/ids";
import type { PlatformExecutor } from "~/server/platform/database/executor";
import type { InvitesTable } from "~/server/platform/database/types";

export type InviteRow = Selectable<InvitesTable>;

export type NewInvite = Omit<
  InviteRow,
  | "id"
  | "status"
  | "accepted_account_id"
  | "accepted_at"
  | "revoked_at"
  | "last_delivered_at"
>;

// Platform store. Every lookup but the token's names its workspace, so one
// workspace can never read or change another's invites.
export function createUserInvitesRepo(db: PlatformExecutor) {
  return {
    async create(values: NewInvite): Promise<UserInviteId> {
      const id = UserInviteId.mint();
      await db
        .insertInto("invites")
        .values({
          ...values,
          id,
          status: "pending",
          accepted_account_id: null,
          accepted_at: null,
          revoked_at: null,
          last_delivered_at: null,
        })
        .execute();
      return id;
    },

    listPendingByBranch(
      workspaceId: WorkspaceId,
      branchId: BranchId,
      activeAsOf: Date,
    ): Promise<InviteRow[]> {
      return db
        .selectFrom("invites")
        .selectAll()
        .where("workspace_id", "=", workspaceId)
        .where("branch_id", "=", branchId)
        .where("status", "=", "pending")
        .where("expires_at", ">", activeAsOf)
        .orderBy("created_at", "desc")
        .execute();
    },

    findById(workspaceId: WorkspaceId, inviteId: UserInviteId) {
      return db
        .selectFrom("invites")
        .selectAll()
        .where("workspace_id", "=", workspaceId)
        .where("id", "=", inviteId)
        .executeTakeFirst();
    },

    findPendingByEmail(
      workspaceId: WorkspaceId,
      email: string,
      activeAsOf: Date,
    ) {
      return db
        .selectFrom("invites")
        .selectAll()
        .where("workspace_id", "=", workspaceId)
        .where("email", "=", email)
        .where("status", "=", "pending")
        .where("expires_at", ">", activeAsOf)
        .executeTakeFirst();
    },

    // An email holds one pending invite per workspace; a new one replaces it.
    async revokePendingByEmail(
      workspaceId: WorkspaceId,
      email: string,
      revokedAt: Date,
    ): Promise<void> {
      await db
        .updateTable("invites")
        .set({ status: "revoked", revoked_at: revokedAt })
        .where("workspace_id", "=", workspaceId)
        .where("email", "=", email)
        .where("status", "=", "pending")
        .execute();
    },

    findPendingByTokenHash(tokenHash: string, activeAsOf: Date) {
      return db
        .selectFrom("invites")
        .selectAll()
        .where("token_hash", "=", tokenHash)
        .where("status", "=", "pending")
        .where("expires_at", ">", activeAsOf)
        .executeTakeFirst();
    },

    // The old link stops working: only the hash of the new token is kept.
    async rotateToken(
      workspaceId: WorkspaceId,
      inviteId: UserInviteId,
      values: { token_hash: string; expires_at: Date },
    ): Promise<boolean> {
      const result = await db
        .updateTable("invites")
        .set(values)
        .where("workspace_id", "=", workspaceId)
        .where("id", "=", inviteId)
        .where("status", "=", "pending")
        .executeTakeFirst();
      return Number(result.numUpdatedRows ?? 0) > 0;
    },

    async revoke(
      workspaceId: WorkspaceId,
      inviteId: UserInviteId,
      revokedAt: Date,
    ): Promise<boolean> {
      const result = await db
        .updateTable("invites")
        .set({ status: "revoked", revoked_at: revokedAt })
        .where("workspace_id", "=", workspaceId)
        .where("id", "=", inviteId)
        .where("status", "=", "pending")
        .executeTakeFirst();
      return Number(result.numUpdatedRows ?? 0) > 0;
    },

    async markAccepted(
      inviteId: UserInviteId,
      accountId: UserId,
      acceptedAt: Date,
    ): Promise<boolean> {
      const result = await db
        .updateTable("invites")
        .set({
          status: "accepted",
          accepted_account_id: accountId,
          accepted_at: acceptedAt,
        })
        .where("id", "=", inviteId)
        .where("status", "=", "pending")
        .executeTakeFirst();
      return Number(result.numUpdatedRows ?? 0) > 0;
    },

    async markDelivered(
      workspaceId: WorkspaceId,
      inviteId: UserInviteId,
      deliveredAt: Date,
    ): Promise<void> {
      await db
        .updateTable("invites")
        .set({ last_delivered_at: deliveredAt })
        .where("workspace_id", "=", workspaceId)
        .where("id", "=", inviteId)
        .execute();
    },
  };
}

export type UserInvitesRepo = ReturnType<typeof createUserInvitesRepo>;
