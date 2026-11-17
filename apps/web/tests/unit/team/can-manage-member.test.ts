import { describe, expect, it } from "vitest";

import { canManageMember } from "~/domain/auth/access/member-management";
import {
  BASELINE_ASSIGNABLE,
  BASELINE_PERMISSIONS,
  type Role,
} from "~/domain/auth/access/rbac";
import { RoleId } from "~/domain/ids";

function canManage(actor: Role, target: Role): boolean {
  return canManageMember(
    {
      role: actor,
      permissions: BASELINE_PERMISSIONS[actor],
      assignableRoleIds: (BASELINE_ASSIGNABLE[actor] ?? []).map((kind) =>
        RoleId.trust(kind),
      ),
    },
    { id: RoleId.trust(target), kind: target },
  );
}

describe("canManageMember", () => {
  it("lets hr assign an executive but not manage one", () => {
    expect(canManage("hr", "executive")).toBe(false);
  });

  it("lets an admin manage an executive", () => {
    expect(canManage("admin", "executive")).toBe(true);
  });
});
