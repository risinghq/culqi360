import type { BulkImportSetup, InviteManagement } from "~/contracts/team";
import { assignableRoleOptions } from "~/domain/auth/access/member-management";
import type { DomainError } from "~/domain/errors";
import { shortName } from "~/domain/identity/display-name";
import type { UserInviteId } from "~/domain/ids";
import { epochMilliseconds } from "~/domain/time/clock";
import type {
  InviteIssueResult,
  WorkspaceInviteService,
} from "~/server/invites/application/types";
import { inviteLink } from "~/server/invites/domain/invite-link";
import type { AppContext } from "~/server/platform/action/context";
import type { OperationContext } from "~/server/platform/operation/context";
import { createLogger } from "~/shared/observability/runtime-logger";
import { isErr, Ok, type Result } from "~/shared/result";

import type {
  TeamInviteCreateContext,
  TeamInviteProvisioningContext,
  TeamInviteResendContext,
} from "../infrastructure/invite-context";
import type { CreateTeamInviteCommand } from "./contracts";
import type { InviteManagementQueryPort } from "./ports";

const logger = createLogger("team.invites");

export interface CreateTeamInviteResult {
  inviteId: string;
  email: string;
  inviteUrl: string;
  delivered: boolean;
}

async function deliverInviteEmail(
  deps: Pick<TeamInviteCreateContext, "delivery" | "publicOrigin"> & {
    inviteService: Pick<WorkspaceInviteService, "markInviteDelivered">;
  },
  issued: InviteIssueResult,
  operation: OperationContext,
): Promise<boolean> {
  const sent = await deps.delivery.send({
    email: issued.email,
    fullName: shortName(issued.fullName),
    roleName: issued.roleName,
    inviteUrl: inviteLink(deps.publicOrigin, issued.token),
    expiresAt: issued.expiresAt,
  });

  if (isErr(sent)) {
    logger.error("invite.email_delivery_failed", {
      inviteId: issued.inviteId,
      code: sent.error.code,
    });
    return false;
  }

  await deps.inviteService.markInviteDelivered(issued.inviteId, operation);
  return true;
}

export async function getInviteManagement(
  ctx: AppContext,
  port: InviteManagementQueryPort,
): Promise<Result<InviteManagement, DomainError>> {
  const [teams, pendingInvites, roles] = await Promise.all([
    port.listTeamsByBranch(ctx.actor.branchId),
    port.listPendingInvites(ctx.actor.branchId, ctx),
    port.listRoles(),
  ]);

  return Ok({
    pendingInvites: pendingInvites.map((invite) => ({
      inviteId: invite.inviteId,
      names: invite.names,
      firstSurname: invite.firstSurname,
      secondSurname: invite.secondSurname,
      email: invite.email,
      role: invite.role,
      roleName: invite.roleName,
      teamId: invite.teamId,
      expiresAt: epochMilliseconds(invite.expiresAt),
      createdAt: epochMilliseconds(invite.createdAt),
      lastDeliveredAt: invite.lastDeliveredAt
        ? epochMilliseconds(invite.lastDeliveredAt)
        : null,
    })),
    teams,
    assignableRoles: assignableRoleOptions(ctx.actor, roles),
  });
}

export async function getBulkImportSetup(
  ctx: AppContext,
  port: Pick<InviteManagementQueryPort, "listRoles">,
): Promise<Result<BulkImportSetup, DomainError>> {
  return Ok({
    assignableRoles: assignableRoleOptions(ctx.actor, await port.listRoles()),
  });
}

export async function createTeamInvite(
  ctx: AppContext,
  deps: TeamInviteCreateContext,
  input: CreateTeamInviteCommand,
): Promise<Result<CreateTeamInviteResult, DomainError>> {
  await deps.enforceInviteCreateRateLimit(ctx.actor.userId, ctx);

  const created = await deps.inviteService.createInvite(
    {
      actorUserId: ctx.actor.userId,
      actor: ctx.actor,
      branchId: ctx.actor.branchId,
      names: input.names,
      firstSurname: input.firstSurname,
      secondSurname: input.secondSurname,
      email: input.email,
      roleId: input.roleId,
      executiveCategory: input.executiveCategory,
      teamId: input.teamId,
      expiresAt: input.expiresAt,
    },
    ctx,
  );

  if (isErr(created)) {
    return created;
  }

  const delivered = await deliverInviteEmail(deps, created.value, ctx);

  return Ok({
    inviteId: created.value.inviteId,
    email: created.value.email,
    inviteUrl: inviteLink(deps.publicOrigin, created.value.token),
    delivered,
  });
}

function manageInput(ctx: AppContext, inviteId: UserInviteId) {
  return {
    actorUserId: ctx.actor.userId,
    actor: ctx.actor,
    branchId: ctx.actor.branchId,
    inviteId,
  };
}

// Only a token hash is stored, so a link is shown once. Resending and copying
// both issue a new link, and the previous one stops working.
export async function resendTeamInvite(
  ctx: AppContext,
  deps: TeamInviteResendContext,
  input: { inviteId: UserInviteId },
): Promise<Result<{ delivered: boolean }, DomainError>> {
  const renewed = await deps.inviteService.renewInvite(
    manageInput(ctx, input.inviteId),
    ctx,
  );

  if (isErr(renewed)) {
    return renewed;
  }

  return Ok({ delivered: await deliverInviteEmail(deps, renewed.value, ctx) });
}

export async function renewTeamInviteLink(
  ctx: AppContext,
  deps: Pick<TeamInviteResendContext, "inviteService" | "publicOrigin">,
  input: { inviteId: UserInviteId },
): Promise<Result<{ inviteUrl: string }, DomainError>> {
  const renewed = await deps.inviteService.renewInvite(
    manageInput(ctx, input.inviteId),
    ctx,
  );

  if (isErr(renewed)) {
    return renewed;
  }

  return Ok({ inviteUrl: inviteLink(deps.publicOrigin, renewed.value.token) });
}

export async function revokeTeamInvite(
  ctx: AppContext,
  deps: TeamInviteProvisioningContext,
  input: { inviteId: UserInviteId },
): Promise<Result<void, DomainError>> {
  return deps.inviteService.revokeInvite(manageInput(ctx, input.inviteId), ctx);
}
