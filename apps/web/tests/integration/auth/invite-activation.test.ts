import { expectOk } from "@tests/support/_core/assertions";
import { createInviteTestKit } from "@tests/support/invite/api";
import { roleIdByKey, SUPERUSER_ASSIGNER } from "@tests/support/invite/roles";
import { operationAt } from "@tests/support/operation";
import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  TEST_FIXTURES,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { submitInviteAcceptance } from "~/server/auth/flows/submit-invite-acceptance";
import { runAsPlatform } from "~/server/platform/database/workspace-scope";
import { isErr } from "~/shared/result";

const NOW = new Date("2026-01-01T00:00:00Z");

const REQUEST = {
  ipAddress: "198.51.100.44",
  userAgent: "vitest-agent",
};

describe("invite activation", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("invite-activation");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  async function createPendingInvite() {
    const kit = createInviteTestKit(ctx);
    const invite = expectOk(
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

    return { kit, invite };
  }

  function acceptInvite(
    kit: ReturnType<typeof createInviteTestKit>,
    input: unknown,
  ) {
    // An invite link is opened anonymously, so the request has platform scope.
    return runAsPlatform(() =>
      submitInviteAcceptance(
        {
          inviteService: kit.service,
          repos: {
            users: ctx.repos.users,
            sessions: ctx.repos.sessions,
          },
        },
        REQUEST,
        input,
        operationAt(NOW),
      ),
    );
  }

  it.each([
    ["invite_token_malformed", "invalid", "StrongPassword123", undefined],
    ["invite_password_too_short", undefined, "Password1", undefined],
    [
      "invite_password_missing_uppercase",
      undefined,
      "lowercasepassword1",
      undefined,
    ],
    [
      "invite_password_missing_lowercase",
      undefined,
      "UPPERCASEPASSWORD1",
      undefined,
    ],
    [
      "invite_password_missing_number",
      undefined,
      "PasswordWithoutDigits",
      undefined,
    ],
    ["password_mismatch", undefined, "Password1234", "different"],
  ] as const)(
    "keeps the invitation usable when activation input is rejected (%s)",
    async (code, tokenInput, password, confirmPassword) => {
      const { kit, invite } = await createPendingInvite();

      const result = await acceptInvite(kit, {
        token: tokenInput ?? invite.token,
        password,
        confirmPassword,
      });

      expect(isErr(result)).toBe(true);
      if (!isErr(result)) {
        throw new Error("expected rejected activation");
      }

      expect(result.error.code).toBe(code);
      expect(await kit.expect.inviteStatus(invite.inviteId)).toBe("pending");

      const pendingInvite = await ctx.repos.userInvites.findById(
        invite.inviteId,
      );
      if (!pendingInvite) {
        throw new Error("expected pending invitation");
      }

      const sessions = await ctx.repos.sessions.listForUser(
        pendingInvite.user_id,
      );
      expect(sessions).toHaveLength(0);
    },
  );

  it("allows activation after rejected input", async () => {
    const { kit, invite } = await createPendingInvite();

    const rejected = await acceptInvite(kit, {
      token: invite.token,
      password: "Password1",
    });

    expect(isErr(rejected)).toBe(true);

    expectOk(
      await acceptInvite(kit, {
        token: invite.token,
        password: "StrongPassword123",
      }),
    );

    expect(await kit.expect.inviteStatus(invite.inviteId)).toBe("accepted");
  });

  it("rejects malformed transport payloads without consuming the invitation", async () => {
    const { kit, invite } = await createPendingInvite();

    for (const [input, code] of [
      [null, "invite_token_malformed"],
      [[], "invite_token_malformed"],
      [{ token: invite.token, password: null }, "invite_password_too_short"],
      [
        {
          token: invite.token,
          password: "StrongPassword123",
          confirmPassword: null,
        },
        "password_mismatch",
      ],
    ] as const) {
      const result = await acceptInvite(kit, input);

      expect(isErr(result)).toBe(true);
      if (!isErr(result)) {
        throw new Error("expected rejected activation");
      }

      expect(result.error.code).toBe(code);
    }

    expect(await kit.expect.inviteStatus(invite.inviteId)).toBe("pending");

    const pendingInvite = await ctx.repos.userInvites.findById(invite.inviteId);
    if (!pendingInvite) {
      throw new Error("expected pending invitation");
    }

    expect(await ctx.repos.sessions.listForUser(pendingInvite.user_id)).toEqual(
      [],
    );
  });

  it("activates a pending account and starts onboarding", async () => {
    const { kit, invite } = await createPendingInvite();

    const result = expectOk(
      await acceptInvite(kit, {
        token: invite.token,
        password: "StrongPassword123",
      }),
    );

    expect(result.redirectTo).toBe("/onboarding");
    expect(await kit.expect.inviteStatus(invite.inviteId)).toBe("accepted");

    const acceptedInvite = await ctx.repos.userInvites.findById(
      invite.inviteId,
    );
    if (!acceptedInvite) {
      throw new Error("expected accepted invitation");
    }

    expect(await kit.expect.userActive(acceptedInvite.user_id)).toBe(true);
    expect(
      await ctx.db
        .selectFrom("events")
        .select("workspace_id")
        .where("type", "=", "user_invite_accepted")
        .execute(),
    ).toEqual([{ workspace_id: TEST_FIXTURES.workspace.id }]);

    const sessions = await ctx.repos.sessions.listForUser(
      acceptedInvite.user_id,
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      session_class: "pre_auth",
      primary_auth_method: "password",
      ip_address: REQUEST.ipAddress,
      user_agent: REQUEST.userAgent,
    });
  });
});
