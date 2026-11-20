import type { Kysely } from "kysely";

import { databaseConfig } from "~/server/platform/config/env";
import { createWorkspace } from "~/server/roles/create-workspace";
import { createLogger } from "~/shared/observability/runtime-logger";

import { fileStores } from "./bun-store";
import {
  openPlatformStore,
  openRegistryStore,
  openWorkspaceStore,
} from "./open-store";
import {
  runDemoEntelSeedStage,
  runDemoIdentitiesSeedStage,
  runDemoMerchantStatsSeedStage,
  runDemoWorkflowSeedStage,
} from "./seeds/demo";
import type { OpenSeedWorkspace } from "./seeds/demo/entel";
import {
  provisionInstallation,
  verifyInstallation,
} from "./seeds/installation";
import {
  type InstallationAdmin,
  persistInstallationAdmin,
  resolveInstallationAdmin,
} from "./seeds/installation/admin";
import { INSTALLATION_WORKSPACE_ID } from "./seeds/installation/workspace-id";
import { createSeedContext } from "./seeds/shared/context";
import type { SeedStores } from "./seeds/shared/people";
import { workspaceStoreName } from "./store";
import type { PlatformDatabase, RegistryDatabase } from "./types";

const logger = createLogger("db-seed");

export interface SeedTarget {
  platform: Kysely<PlatformDatabase>;
  registry: Kysely<RegistryDatabase>;
  workspace: OpenSeedWorkspace;
}

// The installation workspace with its branches, roles and policies, and no
// demo data. The e2e template starts from this.
export async function createInstallation(
  installation: SeedStores,
  anchorDate: Date,
): Promise<void> {
  await createWorkspace(installation, {
    id: INSTALLATION_WORKSPACE_ID,
    name: "Culqi",
    modules: ["culqi", "contacts"],
    createdAt: anchorDate,
  });
  await provisionInstallation(installation, anchorDate);
}

// The seed target over every store a data directory holds.
export async function openSeedTarget(dataDir: string): Promise<SeedTarget> {
  const openStore = fileStores(dataDir);
  return {
    platform: (await openPlatformStore(openStore("platform"))).db,
    registry: (await openRegistryStore(openStore("registry"))).db,
    workspace: async (workspaceId) =>
      (await openWorkspaceStore(openStore(workspaceStoreName(workspaceId)))).db,
  };
}

// Development fills the installation with demo people and data. Production
// gets one admin, who invites the rest.
export type SeedPlan =
  | { kind: "development" }
  | { kind: "production"; admin: InstallationAdmin };

// The stores are separate files with no transaction across them, so a seed
// that fails partway leaves a data directory to delete before the next run.
export async function seedIfEmpty(
  target: SeedTarget,
  plan: SeedPlan,
): Promise<void> {
  const installation: SeedStores = {
    platform: target.platform,
    registry: target.registry,
    workspaceId: INSTALLATION_WORKSPACE_ID,
    workspace: await target.workspace(INSTALLATION_WORKSPACE_ID),
  };

  const existing = await target.platform
    .selectFrom("workspaces")
    .select("id")
    .limit(1)
    .executeTakeFirst();
  if (existing) {
    await verifyInstallation(installation);
    logger.info("seed_skipped_already_initialized");
    return;
  }

  logger.info("seed_started");
  const context = createSeedContext();

  await createInstallation(installation, context.anchorDate);

  if (plan.kind === "production") {
    const username = await persistInstallationAdmin(
      installation,
      plan.admin,
      context.anchorDate,
    );
    logger.info("seed_admin_created", { username });
  } else {
    await runDemoIdentitiesSeedStage(installation, context);
    await runDemoWorkflowSeedStage(installation, context);
    await runDemoMerchantStatsSeedStage(installation, context);
    await runDemoEntelSeedStage(target, target.workspace, context);
  }

  await verifyInstallation(installation);
  logger.info("seed_completed");
}

function seedPlanFromEnv(): SeedPlan {
  return process.env.NODE_ENV === "production"
    ? { kind: "production", admin: resolveInstallationAdmin() }
    : { kind: "development" };
}

async function seed() {
  try {
    await seedIfEmpty(
      await openSeedTarget(databaseConfig().dataDir),
      seedPlanFromEnv(),
    );
    process.exit(0);
  } catch (err) {
    logger.error("seed_failed", { error: err });
    process.exit(1);
  }
}

if (import.meta.main) {
  void seed();
}
