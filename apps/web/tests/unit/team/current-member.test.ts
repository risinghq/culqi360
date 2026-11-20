import { makeAppContext, makeAuthSession } from "@tests/support/unit/factories";
import { describe, expect, it, vi } from "vitest";

import { BranchId, UserId } from "~/domain/ids";
import {
  type CurrentMemberRow,
  getCurrentMember,
} from "~/server/users/application/queries/get-current-member";

const userId = UserId.trust("unit-user");

const member: CurrentMemberRow = {
  user_id: userId,
  branch_id: BranchId.trust("unit-branch"),
  email: "ana@example.com",
  names: "Ana",
  first_surname: "Quispe",
  second_surname: "Rojas",
  avatar_storage_key: "avatars/unit-user",
  avatar_version: 3,
};

function deps(row: CurrentMemberRow | undefined) {
  return {
    members: {
      findById: vi.fn<() => Promise<CurrentMemberRow | undefined>>(
        async () => row,
      ),
    },
    findPhone: vi.fn<() => Promise<string | null>>(async () => "+51987654321"),
  };
}

describe("getCurrentMember", () => {
  it("builds the view from the member row, the phone and the actor", async () => {
    const ctx = makeAppContext({
      actor: makeAuthSession({
        role: "supervisor",
        strongAuthMethod: "totp",
        impersonatorUserId: UserId.trust("unit-admin"),
      }),
    });

    const result = await getCurrentMember(ctx, deps(member));

    expect(result).toEqual({
      ok: true,
      value: {
        id: userId,
        email: "ana@example.com",
        names: "Ana",
        firstSurname: "Quispe",
        secondSurname: "Rojas",
        phone: "+51987654321",
        avatarUrl: "/api/me/avatar?v=3",
        avatarVersion: 3,
        role: "supervisor",
        roleName: "supervisor",
        permissions: ctx.actor.permissions,
        modules: ctx.actor.modules,
        sessionClass: "app",
        primaryAuthMethod: "password",
        strongAuthMethod: "totp",
        branchId: "unit-branch",
        impersonating: true,
      },
    });
  });

  it("has no avatar URL without a stored avatar", async () => {
    const result = await getCurrentMember(
      makeAppContext(),
      deps({ ...member, avatar_storage_key: null }),
    );

    expect(result.ok && result.value?.avatarUrl).toBeNull();
  });

  it("answers null when the caller is no longer a member", async () => {
    const result = await getCurrentMember(makeAppContext(), deps(undefined));

    expect(result).toEqual({ ok: true, value: null });
  });
});
