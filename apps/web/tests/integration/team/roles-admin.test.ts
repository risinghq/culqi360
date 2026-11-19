import { expectErr, expectOk } from "@tests/support/_core/assertions";
import { roleIdByKey } from "@tests/support/invite/roles";
import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  TEST_FIXTURES,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { makeAppContext, makeAuthSession } from "@tests/support/unit/factories";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Permission } from "~/domain/auth/access/rbac";
import { CaseTypeId } from "~/domain/ids";
import type { AppContext } from "~/server/platform/action/context";
import { createRolesRuntime } from "~/server/roles/runtime";

const NOW = new Date("2026-11-17T12:00:00.000Z");

function adminContext(permissions?: Permission[]): AppContext {
  const actor = makeAuthSession({
    userId: TEST_FIXTURES.users.superUser.id,
    role: "admin",
  });
  return makeAppContext({
    actor: permissions ? { ...actor, permissions } : actor,
    operationAt: NOW,
  });
}

describe("roles admin", () => {
  let ctx: TestDbContext;
  let roles: ReturnType<typeof createRolesRuntime>;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("roles-admin");
    roles = createRolesRuntime(ctx.db);
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  it("creates a role from its kind's baseline and edits it", async () => {
    const admin = adminContext();
    const roleId = expectOk(
      await roles.create(admin, { name: "Cobranza Norte", kind: "executive" }),
    );
    const executiveId = await roleIdByKey(ctx, "executive");

    const created = expectOk(await roles.getDetail(admin, roleId));
    expect(created.key).toBe("cobranza_norte");
    expect(created.permissions.length).toBeGreaterThan(0);

    expectOk(
      await roles.update(admin, {
        roleId,
        name: "Cobranza",
        permissions: ["team:read"],
        assignableRoleIds: [executiveId],
      }),
    );

    const updated = expectOk(await roles.getDetail(admin, roleId));
    expect(updated).toMatchObject({
      key: "cobranza_norte",
      name: "Cobranza",
      permissions: ["team:read"],
      assignableRoleIds: [executiveId],
    });
  });

  it("rejects a second role whose name slugs to a taken key", async () => {
    const admin = adminContext();
    expectOk(
      await roles.create(admin, { name: "Cobranza", kind: "executive" }),
    );

    const error = expectErr(
      await roles.create(admin, { name: "COBRANZA", kind: "hr" }),
    );
    expect(error.code).toBe("role_key_taken");
  });

  it("refuses a superuser role", async () => {
    const error = expectErr(
      await roles.create(adminContext(), { name: "Root", kind: "superuser" }),
    );
    expect(error.code).toBe("role_kind_not_allowed");
  });

  it("refuses to grant a permission the editor does not hold", async () => {
    const roleId = expectOk(
      await roles.create(adminContext(), { name: "Soporte", kind: "hr" }),
    );
    const limited = adminContext(["role:manage", "team:read"]);

    const error = expectErr(
      await roles.update(limited, {
        roleId,
        name: "Soporte",
        permissions: ["team:read", "admin:manage"],
        assignableRoleIds: [],
      }),
    );
    expect(error.code).toBe("permission_not_grantable");
  });

  it("refuses an assignable role from outside the workspace list", async () => {
    const admin = adminContext();
    const roleId = expectOk(
      await roles.create(admin, { name: "Soporte", kind: "hr" }),
    );
    const superuserId = await roleIdByKey(ctx, "superuser");

    const error = expectErr(
      await roles.update(admin, {
        roleId,
        name: "Soporte",
        permissions: [],
        assignableRoleIds: [superuserId],
      }),
    );
    expect(error.code).toBe("role_not_assignable");
  });

  it("keeps locked roles unchanged", async () => {
    const admin = adminContext();
    const adminRoleId = await roleIdByKey(ctx, "admin");

    const updateError = expectErr(
      await roles.update(admin, {
        roleId: adminRoleId,
        name: "Jefe",
        permissions: [],
        assignableRoleIds: [],
      }),
    );
    const deleteError = expectErr(await roles.remove(admin, adminRoleId));

    expect(updateError.code).toBe("role_locked");
    expect(deleteError.code).toBe("role_locked");
  });

  it("blocks deleting a role with members or a case stage", async () => {
    const admin = adminContext();
    const executiveId = await roleIdByKey(ctx, "executive");
    expect(expectErr(await roles.remove(admin, executiveId)).code).toBe(
      "role_has_members",
    );

    const roleId = expectOk(
      await roles.create(admin, { name: "Revisor", kind: "back_office" }),
    );
    const caseType = await ctx.db
      .insertInto("case_types")
      .values({
        id: CaseTypeId.mint(),
        key: "alta",
        name: "Alta",
        created_at: NOW,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await ctx.db
      .insertInto("case_stages")
      .values({
        case_type_id: caseType.id,
        key: "validacion",
        name: "Validación",
        position: 0,
        owner_role: "revisor",
        statuses: ["pendiente"],
        initial_status: "pendiente",
        gate_stage_key: null,
        gate_statuses: null,
        branch_field: null,
      })
      .execute();
    expect(expectErr(await roles.remove(admin, roleId)).code).toBe(
      "role_owns_stage",
    );
  });

  it("deletes an unused role", async () => {
    const admin = adminContext();
    const roleId = expectOk(
      await roles.create(admin, { name: "Temporal", kind: "hr" }),
    );

    expectOk(await roles.remove(admin, roleId));

    expect(expectErr(await roles.getDetail(admin, roleId)).code).toBe(
      "role_not_found",
    );
  });
});
