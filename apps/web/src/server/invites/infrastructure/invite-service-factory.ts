import type { Kysely, Transaction } from "kysely";

import type { WorkspaceId } from "~/domain/ids";
import { hashPassword, verifyPassword } from "~/server/auth/password/password";
import { createEventsWriter } from "~/server/event-logs/events-repo";
import type {
  PlatformDatabase,
  WorkspaceDatabase,
} from "~/server/platform/database/types";
import { createExecutorUow } from "~/server/platform/database/uow";
import { createRolesRepo } from "~/server/roles/repos-roles";
import { createAccountsRepo } from "~/server/users/repos-accounts";
import { createMembersRepo } from "~/server/users/repos-members";
import { createMembershipsRepo } from "~/server/users/repos-memberships";
import { createTeamsRepo } from "~/server/users/repos-teams";
import { createUserInvitesRepo } from "~/server/users/repos-user-invites";

import { createInviteAcceptanceService } from "../application/accept-invite";
import type {
  AcceptInvitePlatformRepos,
  InvitePlatformPort,
  MemberPlacementPort,
  WorkspaceInviteRepos,
  WorkspaceInviteTransactionRepos,
} from "../application/types";
import { createWorkspaceInviteService } from "../application/workspace-invites";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function bindWorkspaceInviteRepos(
  db: Kysely<WorkspaceDatabase> | Transaction<WorkspaceDatabase>,
): WorkspaceInviteRepos {
  return {
    roles: createRolesRepo(db),
    teams: createTeamsRepo(db),
    members: createMembersRepo(db),
  };
}

function bindWorkspaceInviteTransactionRepos(
  tx: Transaction<WorkspaceDatabase>,
): WorkspaceInviteTransactionRepos {
  return { ...bindWorkspaceInviteRepos(tx), events: createEventsWriter(tx) };
}

export function createWorkspaceInvites(input: {
  workspaceId: WorkspaceId;
  db: Kysely<WorkspaceDatabase>;
  platform: InvitePlatformPort;
}) {
  return createWorkspaceInviteService({
    workspaceId: input.workspaceId,
    inviteTtlMs: INVITE_TTL_MS,
    repos: bindWorkspaceInviteRepos(input.db),
    uow: createExecutorUow(input.db, bindWorkspaceInviteTransactionRepos),
    platform: input.platform,
  });
}

function bindAcceptRepos(
  db: Kysely<PlatformDatabase> | Transaction<PlatformDatabase>,
): AcceptInvitePlatformRepos {
  return {
    invites: createUserInvitesRepo(db),
    accounts: createAccountsRepo(db),
    memberships: createMembershipsRepo(db),
  };
}

export function createInviteAcceptance(input: {
  db: Kysely<PlatformDatabase>;
  workspaces: MemberPlacementPort;
}) {
  return createInviteAcceptanceService({
    repos: bindAcceptRepos(input.db),
    uow: createExecutorUow(input.db, bindAcceptRepos),
    workspaces: input.workspaces,
    hashPassword,
    verifyPassword,
  });
}

// For a host that holds every store in one process (the Bun dev host and the
// tests). The Worker places members through the workspace Durable Object.
export function inProcessMemberPlacement(input: {
  workspaceDb(workspaceId: WorkspaceId): Promise<Kysely<WorkspaceDatabase>>;
  platform: InvitePlatformPort;
}): MemberPlacementPort {
  return {
    async placeMember(workspaceId, member, placedAt) {
      return createWorkspaceInvites({
        workspaceId,
        db: await input.workspaceDb(workspaceId),
        platform: input.platform,
      }).placeMember(member, placedAt);
    },
  };
}
