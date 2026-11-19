import { auditEntityId } from "~/domain/audit/entity";
import { endMemberExtensionAccess } from "~/server/extension/end-member-access";
import type { AppUow } from "~/server/platform/database/uow";
import type { MemberLifecycleTx } from "~/server/users/application/ports";
import type { MembersRepo } from "~/server/users/repos-members";
import { Ok } from "~/shared/result";

export interface ExpireMembersDeps {
  members: Pick<MembersRepo, "findActiveIdsExpiringBefore">;
  lifecycle: AppUow<
    Pick<MemberLifecycleTx, "members" | "extension" | "sessions" | "events">
  >;
}

// Deactivates every member of this workspace whose expiry has passed and signs
// them out of it. Returns how many members expired.
export async function expireMembers(
  expiredBefore: Date,
  deps: ExpireMembersDeps,
): Promise<number> {
  const candidates =
    await deps.members.findActiveIdsExpiringBefore(expiredBefore);

  let expiredCount = 0;

  for (const { user_id: userId } of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const expired = await deps.lifecycle.run(async (tx) => {
      if (!(await tx.members.deactivateIfExpired(userId, expiredBefore))) {
        return Ok(false);
      }

      await endMemberExtensionAccess(tx.extension, {
        accountId: userId,
        endedAt: expiredBefore,
      });
      await tx.sessions.deleteForUser(userId);
      await tx.events.append({
        type: "account_expired",
        entityType: "user",
        entityId: auditEntityId("user", userId),
        subjectUserId: userId,
        occurredAt: expiredBefore,
      });
      return Ok(true);
    });
    if (expired.ok && expired.value) {
      expiredCount += 1;
    }
  }

  return expiredCount;
}
