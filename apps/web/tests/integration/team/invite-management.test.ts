import { expectOk } from "@tests/support/_core/assertions";
import { createInviteTestKit } from "@tests/support/invite/api";
import { roleIdByKey, SUPERUSER_ASSIGNER } from "@tests/support/invite/roles";
import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  TEST_FIXTURES,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { makeAppContext, makeAuthSession } from "@tests/support/unit/factories";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { RoleId } from "~/domain/ids";
import type { AppContext } from "~/server/platform/action/context";
import { getInviteManagement } from "~/server/team/application/invites";
import { createInviteManagementContext } from "~/server/team/infrastructure/invite-management-context";

const HR_BRANCH_ID = TEST_FIXTURES.branches.lima.id;
const OTHER_BRANCH_ID = TEST_FIXTURES.branches.norte.id;
const NOW = new Date("2026-07-15T12:00:00.000Z");
const CONFIGURED_ORIGIN = "https://crm.example.test";

function makeHrContext(assignableRoleIds: readonly RoleId[]): AppContext {
  return makeAppContext({
    actor: makeAuthSession({
      id: "hr-session",
      userId: TEST_FIXTURES.users.backOne.id,
      role: "hr",
      branchId: HR_BRANCH_ID,
      assignableRoleIds,
    }),
    requestId: "req-test",
    traceId: "trace-test",
    userAgent: null,
    operationAt: NOW,
  });
}

async function seedTeam(ctx: TestDbContext, branchId: string, name: string) {
  return ctx.db
    .insertInto("teams")
    .values({
      branch_id: branchId,
      name,
      created_at: NOW,
    })
    .returning(["id", "name"])
    .executeTakeFirstOrThrow();
}

describe("getInviteManagement", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("invite-management");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  it("scopes teams and pending invites to the actor's branch", async () => {
    const [ownTeam] = await Promise.all([
      seedTeam(ctx, HR_BRANCH_ID, "Operaciones"),
      seedTeam(ctx, OTHER_BRANCH_ID, "Otro Equipo"),
    ]);

    const kit = createInviteTestKit(ctx, { now: () => NOW });
    const executiveRoleId = await roleIdByKey(ctx, "executive");

    const ownInvite = expectOk(
      await kit.commands.create({
        actorUserId: TEST_FIXTURES.users.superUser.id,
        actor: SUPERUSER_ASSIGNER,
        branchId: HR_BRANCH_ID,
        names: "Pending",
        firstSurname: "User",
        secondSurname: "Lima",
        email: "pending-lima@test.local",
        roleId: executiveRoleId,
        executiveCategory: "elite",
        teamId: null,
      }),
    );

    await kit.commands.create({
      actorUserId: TEST_FIXTURES.users.superUser.id,
      actor: SUPERUSER_ASSIGNER,
      branchId: OTHER_BRANCH_ID,
      names: "Pending",
      firstSurname: "User",
      secondSurname: "Norte",
      email: "pending-norte@test.local",
      roleId: executiveRoleId,
      executiveCategory: "elite",
      teamId: null,
    });

    const value = expectOk(
      await getInviteManagement(
        makeHrContext([executiveRoleId]),
        createInviteManagementContext(ctx.db),
        CONFIGURED_ORIGIN,
      ),
    );

    expect(value.teams).toEqual([{ id: ownTeam.id, name: ownTeam.name }]);

    expect(value.pendingInvites).toHaveLength(1);

    expect(value.pendingInvites[0]).toMatchObject({
      inviteId: ownInvite.inviteId,
      email: "pending-lima@test.local",
      inviteUrl: `${CONFIGURED_ORIGIN}/login/invite/${ownInvite.token}`,
    });

    expect(value.assignableRoles.map((role) => role.value)).toEqual([
      executiveRoleId,
    ]);
  });
});
