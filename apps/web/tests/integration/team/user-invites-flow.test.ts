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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const NOW = new Date(1_700_000_000_000);

describe("user invite lifecycle", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("user-invites-flow");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  it("creates and accepts an invite for a new user", async () => {
    const kit = createInviteTestKit(ctx, {
      now: () => NOW,
    });

    const created = expectOk(
      await kit.commands.create({
        actorUserId: TEST_FIXTURES.users.superUser.id,
        actor: SUPERUSER_ASSIGNER,
        branchId: TEST_FIXTURES.branches.norte.id,
        names: "Nueva",
        firstSurname: "Ejecutiva",
        secondSurname: "Garcia",
        email: "nueva-ejecutiva@test.local",
        roleId: await roleIdByKey(ctx, "executive"),
        executiveCategory: "elite",
        teamId: null,
      }),
    );

    const accepted = expectOk(
      await kit.commands.accept({
        token: created.token,
        password: "StrongPass123",
      }),
    );

    expect(await kit.expect.memberActive(accepted.accountId)).toBe(true);
    expect(await kit.expect.inviteStatus(created.inviteId)).toBe("accepted");
  });

  it("can revoke a pending invite", async () => {
    const kit = createInviteTestKit(ctx, {
      now: () => NOW,
    });

    const created = expectOk(
      await kit.commands.create({
        actorUserId: TEST_FIXTURES.users.superUser.id,
        actor: SUPERUSER_ASSIGNER,
        branchId: TEST_FIXTURES.branches.norte.id,
        names: "Nuevo",
        firstSurname: "Analista",
        secondSurname: "Lopez",
        email: "nuevo-analista@test.local",
        roleId: await roleIdByKey(ctx, "back_office"),
        teamId: null,
      }),
    );

    expectOk(
      await kit.commands.revoke({
        actorUserId: TEST_FIXTURES.users.superUser.id,
        actor: SUPERUSER_ASSIGNER,
        branchId: TEST_FIXTURES.branches.norte.id,
        inviteId: created.inviteId,
      }),
    );

    expect(await kit.expect.inviteStatus(created.inviteId)).toBe("revoked");
  });
});
