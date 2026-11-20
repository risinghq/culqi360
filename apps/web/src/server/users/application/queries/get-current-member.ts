import type { CurrentUserView } from "~/contracts/auth";
import type { DomainError } from "~/domain/errors";
import type { UserId } from "~/domain/ids";
import type { AppContext } from "~/server/platform/action/context";
import type { MembersRepo } from "~/server/users/repos-members";
import { Ok, type Result } from "~/shared/result";

type MemberRow = NonNullable<Awaited<ReturnType<MembersRepo["findById"]>>>;

export type CurrentMemberRow = Pick<
  MemberRow,
  | "user_id"
  | "branch_id"
  | "email"
  | "names"
  | "first_surname"
  | "second_surname"
  | "avatar_storage_key"
  | "avatar_version"
>;

// The app shell asks on every load and guarded navigation, so the answer comes
// from this workspace alone: the member row holds the account's name and
// avatar copies, and the session actor holds the rest.
export async function getCurrentMember(
  ctx: AppContext,
  deps: {
    members: {
      findById: (userId: UserId) => Promise<CurrentMemberRow | undefined>;
    };
    findPhone: (userId: UserId) => Promise<string | null>;
  },
): Promise<Result<CurrentUserView | null, DomainError>> {
  const { actor } = ctx;
  const [member, phone] = await Promise.all([
    deps.members.findById(actor.userId),
    deps.findPhone(actor.userId),
  ]);
  if (!member) {
    return Ok(null);
  }

  return Ok({
    id: member.user_id,
    email: member.email,
    names: member.names,
    firstSurname: member.first_surname,
    secondSurname: member.second_surname,
    phone,
    avatarUrl: member.avatar_storage_key
      ? `/api/me/avatar?v=${member.avatar_version}`
      : null,
    avatarVersion: member.avatar_version,
    role: actor.role,
    roleName: actor.roleName,
    permissions: actor.permissions,
    modules: actor.modules,
    sessionClass: actor.sessionClass,
    primaryAuthMethod: actor.primaryAuthMethod,
    strongAuthMethod: actor.strongAuthMethod,
    branchId: member.branch_id,
    impersonating: actor.impersonatorUserId !== null,
  });
}
