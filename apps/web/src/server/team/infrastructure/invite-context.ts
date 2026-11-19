import type { Kysely } from "kysely";

import type { UserId, WorkspaceId } from "~/domain/ids";
import type {
  InvitePlatformPort,
  WorkspaceInviteService,
} from "~/server/invites/application/types";
import { createWorkspaceInvites } from "~/server/invites/infrastructure/invite-service-factory";
import type { AppContext } from "~/server/platform/action/context";
import type { WorkspaceDatabase } from "~/server/platform/database/types";
import { createRolesRepo, type RolesRepo } from "~/server/roles/repos-roles";
import type { ActionRateLimiter } from "~/server/security/action-rate-limit";

import type { InviteDelivery } from "../application/ports";

interface TeamInviteContext {
  repos: { roles: Pick<RolesRepo, "findById"> };
  inviteService: WorkspaceInviteService;
  delivery: InviteDelivery;
  publicOrigin: string;
  enforceInviteCreateRateLimit(
    userId: UserId,
    context: AppContext,
  ): Promise<void>;
}

export function createTeamInviteContext(input: {
  workspaceId: WorkspaceId;
  db: Kysely<WorkspaceDatabase>;
  platform: InvitePlatformPort;
  rateLimiter: ActionRateLimiter;
  publicOrigin: string;
  delivery: InviteDelivery;
}): TeamInviteContext {
  return {
    repos: { roles: createRolesRepo(input.db) },
    inviteService: createWorkspaceInvites(input),
    delivery: input.delivery,
    publicOrigin: input.publicOrigin,
    async enforceInviteCreateRateLimit(userId: UserId, context: AppContext) {
      await input.rateLimiter.enforce(
        "team.invite.create",
        userId,
        context,
        context.ipAddress,
      );
    },
  };
}

export type TeamInviteProvisioningContext = Pick<
  TeamInviteContext,
  "inviteService"
>;
export type TeamInviteCreateContext = Pick<
  TeamInviteContext,
  "delivery" | "inviteService" | "enforceInviteCreateRateLimit" | "publicOrigin"
>;
export type TeamInviteResendContext = Pick<
  TeamInviteContext,
  "delivery" | "inviteService" | "publicOrigin"
>;
export type TeamBulkImportContext = Pick<
  TeamInviteContext,
  "delivery" | "inviteService" | "publicOrigin" | "repos"
>;
