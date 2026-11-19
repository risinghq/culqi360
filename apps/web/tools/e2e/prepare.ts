import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { TeamId } from "~/domain/ids";
import { hashPassword } from "~/server/auth/password/password";
import {
  hashSessionToken,
  isValidTokenFormat,
} from "~/server/auth/session/tokens";
import { insertBatches } from "~/server/platform/database/batches";
import {
  createInstallation,
  INSTALLATION_WORKSPACE_ID,
  openSeedTarget,
} from "~/server/platform/database/seed";
import { INFINITY_BRANCH_ID } from "~/server/platform/database/seeds/installation/persist/branches-policies";
import { createSeedContext } from "~/server/platform/database/seeds/shared/context";
import {
  persistSeedPeople,
  type SeedStores,
} from "~/server/platform/database/seeds/shared/people";
import { roleByKey } from "~/server/roles/role-ref";

import { E2E_DATA_ROOT, TEMPLATE_DIR } from "../../tests/e2e/data";
import { ROSTER } from "../../tests/e2e/roster";
import { sourceFingerprint } from "../support/source-fingerprint";

const BUILD_HASH_FILE = resolve(process.cwd(), "dist/.e2e-build-hash");
// The build artifact proves the build is fresh; the runnable server is the
// Bun entrypoint that imports it.
const BUILD_ARTIFACT = resolve(process.cwd(), "dist/server/server.js");
const ROSTER_PASSWORD = "E2ePassw0rd!";

// Executives need a team to resolve their workspace.
const E2E_TEAM_ID = TeamId.trust("0e2e0000-0000-7000-8000-0000000000a1");

const FINGERPRINT_ROOTS = [
  "src",
  "vite.config.ts",
  "package.json",
  "tracer.ts",
];

function buildIfStale(): void {
  const fingerprint = sourceFingerprint(FINGERPRINT_ROOTS);
  const built =
    existsSync(BUILD_ARTIFACT) &&
    existsSync(BUILD_HASH_FILE) &&
    readFileSync(BUILD_HASH_FILE, "utf8") === fingerprint;

  if (built) {
    console.log("[e2e] build up to date, skipping");
    return;
  }

  console.log("[e2e] building app (dist)...");

  // NODE_ENV=test breaks Rolldown's resolution of shiki's onig.wasm.
  const result = spawnSync("bun", ["run", "build:container"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });

  if (result.status !== 0) {
    throw new Error(`vite build failed with code ${result.status}`);
  }

  writeFileSync(BUILD_HASH_FILE, fingerprint);
}

// One member per role, each with a long-lived session, so a test signs in by
// setting the session cookie.
async function seedRoster(stores: SeedStores, now: Date): Promise<void> {
  const passwordHash = await hashPassword(ROSTER_PASSWORD);
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  await stores.workspace
    .insertInto("teams")
    .values({
      id: E2E_TEAM_ID,
      branch_id: INFINITY_BRANCH_ID,
      name: "E2E Team",
      created_at: now,
    })
    .execute();

  await persistSeedPeople(
    stores,
    ROSTER.map((user) => ({
      id: user.userId,
      branch_id: INFINITY_BRANCH_ID,
      team_id: user.role === "executive" ? E2E_TEAM_ID : null,
      username: user.username,
      email: user.email,
      password_hash: passwordHash,
      names: "E2E",
      first_surname: user.role,
      second_surname: "User",
      onboarding_completed_at: now,
      ...roleByKey(user.role),
      is_active: true,
      created_at: now,
    })),
  );

  const sessions = ROSTER.map((user) => {
    if (!isValidTokenFormat(user.token)) {
      throw new Error(`roster token for '${user.key}' is not a valid format`);
    }
    return {
      id: hashSessionToken(user.token),
      account_id: user.userId,
      workspace_id: stores.workspaceId,
      session_class: "app" as const,
      primary_auth_method: "password" as const,
      strong_auth_method: null,
      strong_auth_at: null,
      impersonator_account_id: null,
      ip_address: "127.0.0.1",
      user_agent: "e2e",
      created_at: now,
      last_activity: now,
      expires_at: expiresAt,
    };
  });
  for (const batch of insertBatches(sessions)) {
    // eslint-disable-next-line no-await-in-loop
    await stores.platform.insertInto("user_sessions").values(batch).execute();
  }
}

// The data directory every worker copies: the installation without demo
// data, plus the roster.
async function buildTemplate(): Promise<void> {
  rmSync(E2E_DATA_ROOT, { recursive: true, force: true });

  const target = await openSeedTarget(TEMPLATE_DIR);
  const stores: SeedStores = {
    platform: target.platform,
    registry: target.registry,
    workspaceId: INSTALLATION_WORKSPACE_ID,
    workspace: await target.workspace(INSTALLATION_WORKSPACE_ID),
  };
  const { anchorDate } = createSeedContext();

  await createInstallation(stores, anchorDate);
  await seedRoster(stores, anchorDate);
}

buildIfStale();
await buildTemplate();
console.log(`[e2e] template ready: ${TEMPLATE_DIR}`);
