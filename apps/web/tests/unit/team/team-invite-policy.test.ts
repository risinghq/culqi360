import { describe, expect, it } from "vitest";

import {
  assignableRoleOptions,
  canAssignRole,
  type RoleAssigner,
  type RoleRef,
} from "~/domain/auth/access/member-management";
import {
  BASELINE_ASSIGNABLE,
  BASELINE_PERMISSIONS,
  ROLES,
  type Role,
} from "~/domain/auth/access/rbac";
import { RoleId } from "~/domain/ids";

// A workspace with one baseline role of each kind, keyed by its kind.
function baselineRole(kind: Role): RoleRef {
  return { id: RoleId.trust(kind), kind };
}

function baselineAssigner(kind: Role): RoleAssigner {
  return {
    role: kind,
    permissions: BASELINE_PERMISSIONS[kind],
    assignableRoleIds: (BASELINE_ASSIGNABLE[kind] ?? []).map((target) =>
      RoleId.trust(target),
    ),
  };
}

function canAssign(actor: Role, target: Role): boolean {
  return canAssignRole(baselineAssigner(actor), baselineRole(target));
}

describe("team invite policy", () => {
  it("enforces assignable roles for hr", () => {
    expect(canAssign("hr", "executive")).toBe(true);
    expect(canAssign("hr", "admin")).toBe(false);
    expect(canAssign("hr", "superuser")).toBe(false);
  });

  it("lets the admin kinds assign every role but a superuser one", () => {
    expect(canAssign("admin", "hr")).toBe(true);
    expect(canAssign("admin", "admin")).toBe(true);
    expect(canAssign("admin", "superuser")).toBe(false);
    expect(canAssign("superuser", "admin")).toBe(true);
    expect(canAssign("superuser", "superuser")).toBe(false);
  });

  it("follows the workspace's list, not the kind, for a custom role", () => {
    const custom: RoleAssigner = {
      role: "hr",
      permissions: BASELINE_PERMISSIONS.hr,
      assignableRoleIds: [RoleId.trust("logistics")],
    };

    expect(canAssignRole(custom, baselineRole("logistics"))).toBe(true);
    expect(canAssignRole(custom, baselineRole("executive"))).toBe(false);
  });

  it("restricts sales manager to staffing their own team", () => {
    expect(canAssign("sales_manager", "executive")).toBe(true);
    expect(canAssign("sales_manager", "supervisor")).toBe(true);
    expect(canAssign("sales_manager", "back_office")).toBe(true);
    expect(canAssign("sales_manager", "sales_manager")).toBe(false);
    expect(canAssign("sales_manager", "logistics")).toBe(false);
    expect(canAssign("sales_manager", "hr")).toBe(false);
    expect(canAssign("sales_manager", "admin")).toBe(false);
    expect(canAssign("sales_manager", "superuser")).toBe(false);

    const roles = ROLES.map((kind) =>
      Object.assign(baselineRole(kind), { name: kind }),
    );
    expect(
      assignableRoleOptions(baselineAssigner("sales_manager"), roles)
        .map((option) => option.kind)
        .toSorted(),
    ).toEqual(["back_office", "executive", "supervisor"]);
  });
});
