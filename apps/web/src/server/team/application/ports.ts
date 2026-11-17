import type { DomainError } from "~/domain/errors";
import type { BranchId } from "~/domain/ids";
import type { PendingBranchInvite } from "~/server/invites/application/types";
import type { OperationContext } from "~/server/platform/operation/context";
import type { RolesRepo } from "~/server/roles/repos-roles";
import type { Result } from "~/shared/result";

export interface InviteDelivery {
  send(input: {
    email: string;
    fullName: string;
    roleName: string;
    inviteUrl: string;
    expiresAt: Date;
  }): Promise<Result<void, DomainError>>;
}

export interface InviteManagementQueryPort {
  listTeamsByBranch(
    branchId: BranchId,
  ): Promise<Array<{ id: string; name: string }>>;
  listPendingInvites(
    branchId: BranchId,
    operation: OperationContext,
  ): Promise<Result<PendingBranchInvite[], DomainError>>;
  listRoles: RolesRepo["list"];
}
