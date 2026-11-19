import type { InvitePlatformPort } from "~/server/invites/application/types";
import type { MessagingGateway } from "~/server/notifications/channels/messaging-gateway";
import type { WorkspaceInfrastructure } from "~/server/platform/infrastructure";
import { createActionRateLimiter } from "~/server/security/action-rate-limit";
import {
  applyBulkImport,
  previewBulkImport,
} from "~/server/team/application/bulk-import";
import {
  createTeamInvite,
  getBulkImportSetup,
  getInviteManagement,
  renewTeamInviteLink,
  resendTeamInvite,
  revokeTeamInvite,
} from "~/server/team/application/invites";
import { createTeamInviteContext } from "~/server/team/infrastructure/invite-context";
import { createInviteDelivery } from "~/server/team/infrastructure/invite-delivery";
import { createInviteManagementContext } from "~/server/team/infrastructure/invite-management-context";

export function createTeamRuntime(
  workspace: Pick<WorkspaceInfrastructure, "workspaceId" | "db">,
  deps: {
    platform: InvitePlatformPort;
    publicOrigin: string;
    messaging: MessagingGateway;
  },
) {
  const invites = createTeamInviteContext({
    workspaceId: workspace.workspaceId,
    db: workspace.db,
    platform: deps.platform,
    rateLimiter: createActionRateLimiter(workspace.db),
    publicOrigin: deps.publicOrigin,
    delivery: createInviteDelivery(deps.messaging),
  });
  const inviteManagement = createInviteManagementContext(
    workspace.db,
    invites.inviteService,
  );

  return {
    invites: {
      create: (
        ctx: Parameters<typeof createTeamInvite>[0],
        input: Parameters<typeof createTeamInvite>[2],
      ) => createTeamInvite(ctx, invites, input),
      resend: (
        ctx: Parameters<typeof resendTeamInvite>[0],
        input: Parameters<typeof resendTeamInvite>[2],
      ) => resendTeamInvite(ctx, invites, input),
      renewLink: (
        ctx: Parameters<typeof renewTeamInviteLink>[0],
        input: Parameters<typeof renewTeamInviteLink>[2],
      ) => renewTeamInviteLink(ctx, invites, input),
      revoke: (
        ctx: Parameters<typeof revokeTeamInvite>[0],
        input: Parameters<typeof revokeTeamInvite>[2],
      ) => revokeTeamInvite(ctx, invites, input),
      previewBulkImport: (
        ctx: Parameters<typeof previewBulkImport>[0],
        input: Parameters<typeof previewBulkImport>[2],
      ) => previewBulkImport(ctx, invites, input),
      applyBulkImport: (
        ctx: Parameters<typeof applyBulkImport>[0],
        input: Parameters<typeof applyBulkImport>[2],
      ) => applyBulkImport(ctx, invites, input),
    },
    management: {
      get: (ctx: Parameters<typeof getInviteManagement>[0]) =>
        getInviteManagement(ctx, inviteManagement),
      bulkImportSetup: (ctx: Parameters<typeof getBulkImportSetup>[0]) =>
        getBulkImportSetup(ctx, inviteManagement),
    },
  };
}
