import type { UserId } from "~/domain/ids";
import type { Phone } from "~/domain/phone/pe-mobile";
import { createUserChannelAddressRepo } from "~/server/notifications/repos/user-channel-address";
import type { AppContext } from "~/server/platform/action/context";
import type { WorkspaceInfrastructure } from "~/server/platform/infrastructure";
import { createRolesRepo } from "~/server/roles/repos-roles";
import type {
  ChangeMemberRoleCommand,
  UpdateMemberExpiryCommand,
  UpdateMemberProfileCommand,
} from "~/server/users/application/contracts";
import type { MemberAccountsPort } from "~/server/users/application/ports";
import { getMemberDetail } from "~/server/users/application/queries/get-member-detail";
import { listBranchMembers } from "~/server/users/application/queries/list-branch-members";
import { changeMemberRole } from "~/server/users/application/use-cases/change-member-role";
import { deactivateMember } from "~/server/users/application/use-cases/deactivate-member";
import { deleteMember } from "~/server/users/application/use-cases/delete-member";
import { generateMemberResetLink } from "~/server/users/application/use-cases/generate-member-reset-link";
import { reactivateMember } from "~/server/users/application/use-cases/reactivate-member";
import { removeMemberAvatar } from "~/server/users/application/use-cases/remove-member-avatar";
import { updateMemberAvatar } from "~/server/users/application/use-cases/update-member-avatar";
import { updateMemberExpiry } from "~/server/users/application/use-cases/update-member-expiry";
import { updateMemberProfile } from "~/server/users/application/use-cases/update-member-profile";
import type { AvatarService } from "~/server/users/avatar-service";
import { createMemberWriteContext } from "~/server/users/infrastructure/member-write-context";
import { createBranchesRepo } from "~/server/users/repos-branches";
import { createMembersRepo } from "~/server/users/repos-members";
import { createTeamsRepo } from "~/server/users/repos-teams";
import { Err, Ok, type Result } from "~/shared/result";

// One workspace's members. The account avatar and the platform side of a
// member change arrive as platform-owned ports.
export function createUsersRuntime(
  workspace: WorkspaceInfrastructure,
  deps: {
    accounts: MemberAccountsPort;
    avatars: AvatarService;
    publicOrigin: string;
  },
) {
  const membersRepo = createMembersRepo(workspace.db);
  const userChannelAddressesRepo = createUserChannelAddressRepo(workspace.db);

  const readDeps = {
    members: membersRepo,
    teams: createTeamsRepo(workspace.db),
    branches: createBranchesRepo(workspace.db),
    roles: createRolesRepo(workspace.db),
  };
  const writeDeps = createMemberWriteContext(workspace.db, deps.accounts);
  const avatarDeps = {
    members: membersRepo,
    avatars: deps.avatars,
  };

  const members = {
    listRoster: (ctx: AppContext) => listBranchMembers(ctx, readDeps),
    getDetail: (ctx: AppContext, userId: UserId) =>
      getMemberDetail(ctx, readDeps, userId),
    updateProfile: (ctx: AppContext, command: UpdateMemberProfileCommand) =>
      updateMemberProfile(ctx, writeDeps, command),
    changeRole: (ctx: AppContext, command: ChangeMemberRoleCommand) =>
      changeMemberRole(ctx, writeDeps, command),
    deactivate: (ctx: AppContext, userId: UserId) =>
      deactivateMember(ctx, writeDeps, userId),
    reactivate: (ctx: AppContext, userId: UserId) =>
      reactivateMember(ctx, writeDeps, userId),
    updateExpiry: (ctx: AppContext, command: UpdateMemberExpiryCommand) =>
      updateMemberExpiry(ctx, writeDeps, command),
    remove: (ctx: AppContext, userId: UserId) =>
      deleteMember(ctx, writeDeps, userId),
    generateResetLink: (ctx: AppContext, userId: UserId) =>
      generateMemberResetLink(
        ctx,
        { ...writeDeps, publicOrigin: deps.publicOrigin },
        userId,
      ),
    uploadAvatar: (ctx: AppContext, command: { userId: UserId; file: File }) =>
      updateMemberAvatar(ctx, avatarDeps, command),
    removeAvatar: (ctx: AppContext, userId: UserId) =>
      removeMemberAvatar(ctx, avatarDeps, userId),
  };

  async function updatePhone(
    userId: UserId,
    phone: Phone,
    claimedAt: Date,
  ): Promise<Result<void, { kind: "address_already_claimed" }>> {
    const claimResult = await userChannelAddressesRepo.claimWhatsAppAddress({
      userId,
      address: phone,
      claimedAt,
    });

    if (claimResult.kind === "already_claimed") {
      return Err({
        kind: "address_already_claimed",
      });
    }

    return Ok(undefined);
  }

  return {
    avatars: deps.avatars,
    updatePhone,
    members,
  };
}
