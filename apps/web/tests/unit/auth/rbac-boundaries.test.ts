import { describe, expect, it } from "vitest";

import {
  BASELINE_PERMISSIONS,
  hasPermission,
  type Permission,
  type Role,
} from "~/domain/auth/access/rbac";

function baselineCan(role: Role, permission: Permission): boolean {
  return hasPermission({ permissions: BASELINE_PERMISSIONS[role] }, permission);
}

describe("baseline role boundaries", () => {
  it("grants nothing to a role with no permissions", () => {
    expect(hasPermission({ permissions: [] }, "lead:work")).toBe(false);
  });

  it("keeps executive and supervisor permissions on separate boundaries", () => {
    expect(baselineCan("supervisor", "sales:approve")).toBe(true);
    expect(baselineCan("executive", "sales:approve")).toBe(false);
    expect(baselineCan("executive", "lead:rate:simulate")).toBe(true);
    expect(baselineCan("supervisor", "team:manage")).toBe(true);
    expect(baselineCan("supervisor", "lead:view:all")).toBe(true);
    expect(baselineCan("executive", "team:manage")).toBe(false);
    expect(baselineCan("executive", "lead:workflow")).toBe(true);
    expect(baselineCan("supervisor", "lead:workflow")).toBe(false);
    expect(baselineCan("executive", "lead:register")).toBe(true);
    expect(baselineCan("supervisor", "lead:register")).toBe(false);
    expect(baselineCan("supervisor", "lead:reassign")).toBe(false);
  });

  it("keeps workflow permissions scoped to the intended roles", () => {
    expect(baselineCan("executive", "lead:workflow")).toBe(true);
    expect(baselineCan("executive", "lead:register")).toBe(true);
    expect(baselineCan("executive", "lead:review")).toBe(false);
    expect(baselineCan("executive", "quotation:create")).toBe(false);
    expect(baselineCan("executive", "quotation:revise")).toBe(false);
    expect(baselineCan("executive", "quotation:view:all")).toBe(false);

    expect(baselineCan("back_office", "lead:workflow")).toBe(false);
    expect(baselineCan("back_office", "lead:view:all")).toBe(true);
    expect(baselineCan("back_office", "lead:review")).toBe(true);
    expect(baselineCan("back_office", "quotation:create")).toBe(true);
    expect(baselineCan("back_office", "quotation:revise")).toBe(true);
    expect(baselineCan("back_office", "quotation:view:all")).toBe(true);
    expect(baselineCan("back_office", "integration:manage")).toBe(true);
    expect(baselineCan("back_office", "lead:register")).toBe(false);

    expect(baselineCan("admin", "lead:workflow")).toBe(false);
    expect(baselineCan("admin", "lead:register")).toBe(false);
    expect(baselineCan("admin", "lead:reassign")).toBe(true);
    expect(baselineCan("admin", "quotation:create")).toBe(true);
    expect(baselineCan("admin", "quotation:revise")).toBe(true);
    expect(baselineCan("admin", "quotation:view:all")).toBe(true);
    expect(baselineCan("admin", "integration:manage")).toBe(true);

    expect(baselineCan("supervisor", "lead:reassign")).toBe(false);
    expect(baselineCan("supervisor", "lead:view:all")).toBe(true);
    expect(baselineCan("sales_manager", "lead:reassign")).toBe(false);
    expect(baselineCan("sales_manager", "lead:view:all")).toBe(true);
    expect(baselineCan("sales_manager", "team:invite")).toBe(true);

    expect(baselineCan("superuser", "lead:workflow")).toBe(false);
    expect(baselineCan("superuser", "lead:register")).toBe(false);
    expect(baselineCan("superuser", "lead:review")).toBe(true);
    expect(baselineCan("superuser", "quotation:create")).toBe(true);
    expect(baselineCan("superuser", "quotation:revise")).toBe(true);
    expect(baselineCan("superuser", "quotation:view:all")).toBe(true);
    expect(baselineCan("superuser", "integration:manage")).toBe(true);

    expect(baselineCan("sales_manager", "data-source:import")).toBe(true);
    expect(baselineCan("admin", "data-source:import")).toBe(true);
    expect(baselineCan("superuser", "data-source:import")).toBe(true);
    expect(baselineCan("executive", "data-source:import")).toBe(false);
    expect(baselineCan("supervisor", "data-source:import")).toBe(false);
    expect(baselineCan("back_office", "data-source:import")).toBe(false);
    expect(baselineCan("logistics", "data-source:import")).toBe(false);
    expect(baselineCan("hr", "data-source:import")).toBe(false);
  });
});
