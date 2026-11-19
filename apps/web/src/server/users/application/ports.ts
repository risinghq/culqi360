import type { UserId, WorkspaceId } from "~/domain/ids";
import type { EventsWriter } from "~/server/event-logs/events-repo";
import type { ExtensionRuntimeRepo } from "~/server/extension/repos";
import type { AppUow } from "~/server/platform/database/uow";
import type { RolesRepo } from "~/server/roles/repos-roles";
import type { SessionRepository } from "~/server/sessions/repos-sessions";
import type { AvatarService } from "~/server/users/avatar-service";
import type { BranchesRepo } from "~/server/users/repos-branches";
import type { MemberWorkloadRepo } from "~/server/users/repos-member-workload";
import type { MembersRepo } from "~/server/users/repos-members";
import type { TeamsRepo } from "~/server/users/repos-teams";

// What a workspace asks of the platform when it changes a member. The
// workspace commits its own write first; these calls follow it.
export interface MemberAccountsPort {
  removeMembership(workspaceId: WorkspaceId, accountId: UserId): Promise<void>;
  // Retires every earlier reset link of the account and stores the new one.
  replaceResetToken(input: {
    accountId: UserId;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
  }): Promise<void>;
}

export type MemberLifecycleTx = {
  members: MembersRepo;
  roles: RolesRepo;
  workload: MemberWorkloadRepo;
  extension: ExtensionRuntimeRepo;
  sessions: Pick<SessionRepository, "deleteForUser">;
  events: EventsWriter;
};

export interface MemberReadDeps {
  members: MembersRepo;
  teams: TeamsRepo;
  branches: BranchesRepo;
  roles: RolesRepo;
}

export interface MemberWriteDeps {
  members: MembersRepo;
  lifecycle: AppUow<MemberLifecycleTx>;
  accounts: MemberAccountsPort;
}

export interface MemberAvatarDeps {
  members: MembersRepo;
  avatars: AvatarService;
}
