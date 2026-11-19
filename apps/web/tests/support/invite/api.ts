import { operationAt } from "@tests/support/operation";

import type { UserId, UserInviteId } from "~/domain/ids";
import type {
  InviteAcceptanceService,
  WorkspaceInviteService,
} from "~/server/invites/application/types";
import { createInvitePlatform } from "~/server/invites/infrastructure/invite-platform";
import {
  createInviteAcceptance,
  createWorkspaceInvites,
  inProcessMemberPlacement,
} from "~/server/invites/infrastructure/invite-service-factory";

import type { TestDbContext } from "../runtime/db";

// The workspace app issues and manages invites for the fixture workspace; the
// platform app accepts them. Both run over the test stores, as on the dev host.
export function createInviteTestKit(
  ctx: TestDbContext,
  options: { now?: () => Date } = {},
) {
  const resolveNow = options.now ?? (() => new Date());
  const platform = createInvitePlatform(ctx.platform);
  const invites: WorkspaceInviteService = createWorkspaceInvites({
    workspaceId: ctx.fixtures.workspace.id,
    db: ctx.db,
    platform,
  });
  const acceptance: InviteAcceptanceService = createInviteAcceptance({
    db: ctx.platform,
    workspaces: inProcessMemberPlacement({
      workspaceDb: async (id) => (await ctx.workspace(id)).db,
      platform,
    }),
  });

  return {
    invites,
    acceptance,

    commands: {
      create: (input: Parameters<WorkspaceInviteService["createInvite"]>[0]) =>
        invites.createInvite(input, operationAt(resolveNow())),
      accept: (input: Parameters<InviteAcceptanceService["acceptInvite"]>[0]) =>
        acceptance.acceptInvite(input, operationAt(resolveNow())),
      renew: (input: Parameters<WorkspaceInviteService["renewInvite"]>[0]) =>
        invites.renewInvite(input, operationAt(resolveNow())),
      revoke: (input: Parameters<WorkspaceInviteService["revokeInvite"]>[0]) =>
        invites.revokeInvite(input, operationAt(resolveNow())),
    },

    expect: {
      async inviteStatus(inviteId: UserInviteId) {
        const invite = await ctx.repos.userInvites.findById(
          ctx.fixtures.workspace.id,
          inviteId,
        );
        return invite?.status;
      },

      async memberActive(userId: UserId) {
        const member = await ctx.repos.members.findById(userId);
        return member?.is_active;
      },
    },
  };
}
