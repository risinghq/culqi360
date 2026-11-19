import type { Selectable } from "kysely";

import { canManageMember } from "~/domain/auth/access/member-management";
import { fail, type DomainError } from "~/domain/errors";
import type { UserId } from "~/domain/ids";
import type { AppContext } from "~/server/platform/action/context";
import type { MembersTable } from "~/server/platform/database/types";
import type { MembersRepo } from "~/server/users/repos-members";
import { Err, Ok, type Result } from "~/shared/result";

export type MemberRow = Selectable<MembersTable>;

// Single owner of the "an administrator may act on this member" invariant, so
// every member write use-case enforces the same checks: the actor must hold
// the team:manage permission, the target must exist in the actor's branch,
// must not be the actor themselves, and the actor's role must be allowed to
// assign the target's role. Delete additionally applies the stricter canDeleteMember check
// at its own site.
export async function authorizeMemberManagement(
  ctx: AppContext,
  members: Pick<MembersRepo, "findById">,
  userId: UserId,
): Promise<Result<MemberRow, DomainError>> {
  const target = await members.findById(userId);
  if (!target || target.branch_id !== ctx.actor.branchId) {
    return Err(fail("user_not_found"));
  }
  if (target.user_id === ctx.actor.userId) {
    return Err(fail("cannot_manage_self"));
  }
  if (!canManageMember(ctx.actor, { id: target.role_id, kind: target.role })) {
    return Err(fail("cannot_manage_member"));
  }
  return Ok(target);
}
