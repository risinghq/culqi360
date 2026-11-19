import { auditEntityId } from "~/domain/audit/entity";
import { canAssignRole } from "~/domain/auth/access/member-management";
import { fail, type DomainError } from "~/domain/errors";
import { endMemberExtensionAccess } from "~/server/extension/end-member-access";
import type { AppContext } from "~/server/platform/action/context";
import { Err, isErr, Ok, type Result } from "~/shared/result";

import type { ChangeMemberRoleCommand } from "../contracts";
import type { MemberWriteDeps } from "../ports";
import { authorizeMemberManagement } from "./authorize-member-management";

// Changing a role revokes the member's live sessions: their permission set
// changes immediately rather than lingering until the next login.
export async function changeMemberRole(
  ctx: AppContext,
  deps: MemberWriteDeps,
  command: ChangeMemberRoleCommand,
): Promise<Result<void, DomainError>> {
  return deps.lifecycle.run(async (tx) => {
    const target = await authorizeMemberManagement(
      ctx,
      tx.members,
      command.userId,
    );
    if (isErr(target)) {
      return target;
    }

    const role = await tx.roles.findById(command.roleId);
    if (!role || !canAssignRole(ctx.actor, role)) {
      return Err(fail("role_not_assignable"));
    }

    const isExecutive = role.kind === "executive";
    if (isExecutive && command.executiveCategory === null) {
      return Err(fail("invalid_executive_category"));
    }

    await tx.members.updateRole(command.userId, {
      role_id: role.id,
      role: role.kind,
      executive_category: isExecutive ? command.executiveCategory : null,
    });
    await endMemberExtensionAccess(tx.extension, {
      accountId: command.userId,
      endedAt: ctx.operationAt,
    });
    await tx.sessions.deleteForUser(command.userId);
    await tx.events.append({
      type: "member_role_changed",
      entityType: "user",
      entityId: auditEntityId("user", command.userId),
      actorUserId: ctx.actor.userId,
      subjectUserId: command.userId,
      payload: { roleId: role.id, role: role.kind },
      occurredAt: ctx.operationAt,
    });
    return Ok(undefined);
  });
}
