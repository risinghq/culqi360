import type { MemberDetail } from "~/contracts/members";
import {
  assignableRoleOptions,
  canDeleteMember,
  canImpersonateMember,
  canManageMember,
  type RoleRef,
} from "~/domain/auth/access/member-management";
import { isPermission } from "~/domain/auth/access/rbac";
import { fail, type DomainError } from "~/domain/errors";
import type { UserId } from "~/domain/ids";
import { appCalendarDateBefore } from "~/domain/time/app-time";
import type { AppContext } from "~/server/platform/action/context";
import { Err, Ok, type Result } from "~/shared/result";

import { memberAvatarUrl } from "../member-view";
import type { MemberReadDeps } from "../ports";

export async function getMemberDetail(
  ctx: AppContext,
  deps: MemberReadDeps,
  userId: UserId,
): Promise<Result<MemberDetail, DomainError>> {
  const user = await deps.members.findById(userId);
  if (!user || user.branch_id !== ctx.actor.branchId) {
    return Err(fail("user_not_found"));
  }

  const [team, branch, branchTeams, roles] = await Promise.all([
    user.team_id ? deps.teams.findById(user.team_id) : Promise.resolve(null),
    deps.branches.findById(user.branch_id),
    deps.teams.findByBranch(user.branch_id),
    deps.roles.list(),
  ]);

  const role = roles.find((candidate) => candidate.id === user.role_id);
  if (!role) {
    return Err(fail("user_not_found"));
  }

  const target: RoleRef = { id: role.id, kind: role.kind };
  const isSelf = user.user_id === ctx.actor.userId;

  return Ok({
    id: user.user_id,
    names: user.names,
    firstSurname: user.first_surname,
    secondSurname: user.second_surname,
    email: user.email,
    role: user.role,
    roleId: role.id,
    roleName: role.name,
    executiveCategory: user.executive_category,
    teamId: user.team_id,
    teamName: team?.name ?? null,
    branchName: branch?.name ?? null,
    isActive: user.is_active,
    onboardingCompleted: user.onboarding_completed_at !== null,
    avatarUrl: memberAvatarUrl(
      user.user_id,
      user.avatar_storage_key !== null,
      user.avatar_version,
    ),
    expiresOn: user.expires_at ? appCalendarDateBefore(user.expires_at) : null,
    permissions: role.permissions.filter(isPermission),
    assignableRoles: assignableRoleOptions(ctx.actor, roles),
    teams: branchTeams.map((branchTeam) => ({
      id: branchTeam.id,
      name: branchTeam.name,
    })),
    canManage: !isSelf && canManageMember(ctx.actor, target),
    canDelete: !isSelf && canDeleteMember(ctx.actor, target),
    canImpersonate: !isSelf && canImpersonateMember(ctx.actor, target),
    isSelf,
  });
}
