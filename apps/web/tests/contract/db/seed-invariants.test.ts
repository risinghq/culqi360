import { operationAt } from "@tests/support/operation";
import { createFreshStores, type FreshStores } from "@tests/support/runtime/db";
import { afterEach, describe, expect, it } from "vitest";

import { changeInstallationPassword } from "~/server/auth/flows/change-installation-password";
import { createAuthLoginContext } from "~/server/auth/infrastructure/login-context";
import { createAuthSetupContext } from "~/server/auth/infrastructure/setup-context";
import { verifyPassword } from "~/server/auth/password/password";
import { requiresStrongAuthRole } from "~/server/auth/policy/rules/role";
import { getStrongAuthStatus } from "~/server/auth/security/strong-auth-status";
import { seedIfEmpty } from "~/server/platform/database/seed";
import { createSessionRepository } from "~/server/sessions/repos-sessions";
import { isErr } from "~/shared/result";

describe("seed invariants", () => {
  let stores: FreshStores | null = null;

  afterEach(() => {
    stores?.close();
    stores = null;
  });

  it("provisions installation accounts and repeatable development fixtures", async () => {
    stores = await createFreshStores();
    const target = {
      platform: stores.platform,
      registry: stores.registry,
      workspace: stores.workspace,
    };

    await seedIfEmpty(target);
    await seedIfEmpty(target);

    const login = createAuthLoginContext(
      stores.platform,
      stores.authWorkspaces,
    );
    const users = login.repos.users;
    const valeria = await users.findByUsername("valeria.paredes");
    const manager = await users.findByUsername("roberto.quispe");
    const installationAdmin = await users.findByUsername("david.duran");

    if (!valeria) {
      throw new Error("valeria not found in seed");
    }

    if (!manager) {
      throw new Error("manager not found in seed");
    }

    if (!installationAdmin) {
      throw new Error("installation administrator not found in seed");
    }

    expect(valeria.onboarding_completed_at).toBeNull();
    expect(valeria.password_change_required).toBe(false);
    expect(requiresStrongAuthRole(valeria.role)).toBe(true);
    expect(installationAdmin.password_change_required).toBe(true);

    const setup = createAuthSetupContext(
      stores.platform,
      stores.authWorkspaces,
    );
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);
    const sessions = createSessionRepository(
      await stores.workspace(installationAdmin.workspace_id),
    );
    const sessionIds = [
      "current-installation-session",
      "stale-installation-session",
    ];

    await Promise.all(
      sessionIds.map((id) =>
        sessions.create({
          id,
          user_id: installationAdmin.id,
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
        userId: installationAdmin.id,
        password: "new-installation-password",
        confirmPassword: "new-installation-password",
      },
      operationAt(now),
    );

    if (isErr(passwordChanged)) {
      throw new Error(passwordChanged.error.code ?? "");
    }

    const updatedAdmin = await users.findById(installationAdmin.id);

    if (!updatedAdmin) {
      throw new Error(
        "installation administrator missing after password change",
      );
    }

    expect(updatedAdmin.password_change_required).toBe(false);

    const remaining = await Promise.all(
      sessionIds.map((id) => sessions.findById(id)),
    );

    expect(remaining).toEqual([null, null]);
    expect(
      await verifyPassword(
        updatedAdmin.password_hash,
        "new-installation-password",
      ),
    ).toBe(true);

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
});
