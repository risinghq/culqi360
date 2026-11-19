import { auditEntityId } from "~/domain/audit/entity";
import { canDeleteMember } from "~/domain/auth/access/member-management";
import { fail, type DomainError } from "~/domain/errors";
import type { UserId } from "~/domain/ids";
import { endMemberExtensionAccess } from "~/server/extension/end-member-access";
import type { AppContext } from "~/server/platform/action/context";
import { Err, isErr, Ok, type Result } from "~/shared/result";

import type { MemberWriteDeps } from "../ports";
import { authorizeMemberManagement } from "./authorize-member-management";

// Deleting removes the membership and signs the member out. The member row
// stays, inactive, so the records it owns keep their owner.
export async function deleteMember(
  ctx: AppContext,
  deps: MemberWriteDeps,
  userId: UserId,
): Promise<Result<void, DomainError>> {
  const changed = await deps.lifecycle.run(async (tx) => {
    const target = await authorizeMemberManagement(ctx, tx.members, userId);
    if (isErr(target)) {
      return target;
    }

    if (
      !canDeleteMember(ctx.actor, {
        id: target.value.role_id,
        kind: target.value.role,
      })
    ) {
      return Err(fail("cannot_manage_member"));
    }

    if ((await tx.workload.countActiveLeads(userId)) > 0) {
      return Err(fail("member_has_active_leads"));
    }

    await tx.members.setActive(userId, false);
    await endMemberExtensionAccess(tx.extension, {
      accountId: userId,
      endedAt: ctx.operationAt,
    });
    await tx.sessions.deleteForUser(userId);
    await tx.events.append({
      type: "member_deleted",
      entityType: "user",
      entityId: auditEntityId("user", userId),
      actorUserId: ctx.actor.userId,
      subjectUserId: userId,
      occurredAt: ctx.operationAt,
    });

    return Ok(undefined);
  });
  if (isErr(changed)) {
    return changed;
  }

  await deps.accounts.removeMembership(ctx.actor.workspaceId, userId);
  return changed;
}
