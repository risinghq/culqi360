import { auditEntityId } from "~/domain/audit/entity";
import { type DomainError } from "~/domain/errors";
import type { UserId } from "~/domain/ids";
import { endMemberExtensionAccess } from "~/server/extension/end-member-access";
import type { AppContext } from "~/server/platform/action/context";
import { isErr, Ok, type Result } from "~/shared/result";

import type { MemberWriteDeps } from "../ports";
import { authorizeMemberManagement } from "./authorize-member-management";

// Deactivation revokes live sessions so access ends immediately; the row is
// kept so the member's history and assignments remain intact.
export async function deactivateMember(
  ctx: AppContext,
  deps: MemberWriteDeps,
  userId: UserId,
): Promise<Result<void, DomainError>> {
  const changed = await deps.lifecycle.run(async (tx) => {
    const target = await authorizeMemberManagement(ctx, tx.members, userId);
    if (isErr(target)) {
      return target;
    }

    await tx.members.setActive(userId, false);
    await endMemberExtensionAccess(tx.extension, {
      accountId: userId,
      endedAt: ctx.operationAt,
    });
    await tx.events.append({
      type: "member_deactivated",
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

  await deps.accounts.endSessions(ctx.actor.workspaceId, userId);
  return changed;
}
