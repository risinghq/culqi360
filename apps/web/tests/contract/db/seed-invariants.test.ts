import { operationAt } from "@tests/support/operation";
import { createFreshStores, type FreshStores } from "@tests/support/runtime/db";
import { afterEach, describe, expect, it } from "vitest";

import { changeInstallationPassword } from "~/server/auth/flows/change-installation-password";
import { createAuthLoginContext } from "~/server/auth/infrastructure/login-context";
import { createAuthSetupContext } from "~/server/auth/infrastructure/setup-context";
import { verifyPassword } from "~/server/auth/password/password";
import { requiresStrongAuthRole } from "~/server/auth/policy/rules/role";
import { getStrongAuthStatus } from "~/server/auth/security/strong-auth-status";
import { seedIfEmpty, type SeedTarget } from "~/server/platform/database/seed";
import { INSTALLATION_WORKSPACE_ID } from "~/server/platform/database/seeds/installation/workspace-id";
import { createSessionRepository } from "~/server/sessions/repos-sessions";
import { isErr } from "~/shared/result";

const ADMIN = {
  email: "ana.torres@example.com",
  names: "Ana María",
  firstSurname: "Torres",
  password: "provisioning-password",
};

function seedTarget(stores: FreshStores): SeedTarget {
  return {
    platform: stores.platform,
    registry: stores.registry,
    workspace: stores.workspace,
  };
}

describe("seed invariants", () => {
  let stores: FreshStores | null = null;

  afterEach(() => {
    stores?.close();
    stores = null;
  });

  it("provisions repeatable development fixtures", async () => {
    stores = await createFreshStores();
    const target = seedTarget(stores);

    await seedIfEmpty(target, { kind: "development" });
    await seedIfEmpty(target, { kind: "development" });

    const login = createAuthLoginContext(
      stores.platform,
      stores.authWorkspaces,
    );
    const users = login.repos.users;
    const valeria = await users.findByUsername("valeria.paredes");
    const manager = await users.findByUsername("roberto.quispe");

    if (!valeria) {
      throw new Error("valeria not found in seed");
    }

    if (!manager) {
      throw new Error("manager not found in seed");
    }

    expect(valeria.onboarding_completed_at).toBeNull();
    expect(valeria.password_change_required).toBe(false);
    expect(requiresStrongAuthRole(valeria.role)).toBe(true);

    const valeriaStatus = await getStrongAuthStatus(valeria.id, login.repos);

    expect(valeriaStatus.hasVerifiedStrongAuth).toBe(false);
    expect(valeriaStatus.hasTotp).toBe(false);
    expect(valeriaStatus.hasPasskey).toBe(false);

    const managerStatus = await getStrongAuthStatus(manager.id, login.repos);

    expect(managerStatus.hasVerifiedStrongAuth).toBe(true);
    expect(managerStatus.hasTotp).toBe(true);

    const entel = await stores.platform
      .selectFrom("workspaces")
      .select("id")
      .where("name", "=", "Entel")
      .executeTakeFirstOrThrow();
    const entelStore = await stores.workspace(entel.id);
    const entelProcesses = await entelStore
      .selectFrom("case_types")
      .select("key")
      .orderBy("key")
      .execute();

    expect(entelProcesses).toEqual([
      { key: "nc_fija" },
      { key: "nc_movil" },
      { key: "quiebre" },
    ]);
  }, 20_000);

  it("provisions production with one admin who must change the password", async () => {
    stores = await createFreshStores();
    const target = seedTarget(stores);

    await seedIfEmpty(target, { kind: "production", admin: ADMIN });
    await seedIfEmpty(target, { kind: "production", admin: ADMIN });

    const workspace = await stores.workspace(INSTALLATION_WORKSPACE_ID);
    const members = await workspace
      .selectFrom("members")
      .select(["username", "email", "role"])
      .execute();

    expect(members).toEqual([
      { username: "anamaria.torres", email: ADMIN.email, role: "admin" },
    ]);

    const login = createAuthLoginContext(
      stores.platform,
      stores.authWorkspaces,
    );
    const users = login.repos.users;
    const admin = await users.findByUsername("anamaria.torres");

    if (!admin) {
      throw new Error("installation administrator not found");
    }

    expect(admin.password_change_required).toBe(true);
    expect(await verifyPassword(admin.password_hash, ADMIN.password)).toBe(
      true,
    );

    const setup = createAuthSetupContext(
      stores.platform,
      stores.authWorkspaces,
    );
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);
    const sessions = createSessionRepository(workspace);
    const sessionIds = [
      "current-installation-session",
      "stale-installation-session",
    ];

    await Promise.all(
      sessionIds.map((id) =>
        sessions.create({
          id,
          user_id: admin.id,
          session_class: "pre_auth",
          primary_auth_method: "password",
          strong_auth_method: null,
          strong_auth_at: null,
          impersonator_user_id: null,
          ip_address: "127.0.0.1",
          user_agent: "seed-invariant-test",
          created_at: now,
          last_activity: now,
          expires_at: expiresAt,
        }),
      ),
    );

    const passwordChanged = await changeInstallationPassword(
      setup,
      {
        userId: admin.id,
        password: "new-installation-password",
        confirmPassword: "new-installation-password",
      },
      operationAt(now),
    );

    if (isErr(passwordChanged)) {
      throw new Error(passwordChanged.error.code ?? "");
    }

    const updatedAdmin = await users.findById(admin.id);

    if (!updatedAdmin) {
      throw new Error(
        "installation administrator missing after password change",
      );
    }

    expect(updatedAdmin.password_change_required).toBe(false);
    expect(
      await Promise.all(sessionIds.map((id) => sessions.findById(id))),
    ).toEqual([null, null]);
    expect(
      await verifyPassword(
        updatedAdmin.password_hash,
        "new-installation-password",
      ),
    ).toBe(true);
  }, 20_000);
});
