import type { Kysely } from "kysely";

import { WorkspaceId } from "~/domain/ids";
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
import { createSeedContext } from "./seeds/shared/context";
import type { SeedStores } from "./seeds/shared/people";
import { stableSeedId } from "./seeds/shared/stable-id";
import { workspaceStoreName } from "./store";
import type { PlatformDatabase, RegistryDatabase } from "./types";

const logger = createLogger("db-seed");

// The installation's workspace. Its first client is Culqi.
export const INSTALLATION_WORKSPACE_ID = WorkspaceId.trust(
  stableSeedId("workspace:culqi"),
);

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

// The stores are separate files with no transaction across them, so a seed
// that fails partway leaves a data directory to delete before the next run.
export async function seedIfEmpty(target: SeedTarget): Promise<void> {
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
  const includeDemoFixtures = process.env.NODE_ENV !== "production";

  await createInstallation(installation, context.anchorDate);

  if (includeDemoFixtures) {
    await runDemoIdentitiesSeedStage(installation, context);
    await runDemoWorkflowSeedStage(installation, context);
    await runDemoMerchantStatsSeedStage(installation, context);
    await runDemoEntelSeedStage(target, target.workspace, context);
  }

  logger.info("seed_completed");
}

async function seed() {
  try {
    await seedIfEmpty(await openSeedTarget(databaseConfig().dataDir));
    process.exit(0);
  } catch (err) {
    logger.error("seed_failed", { error: err });
    process.exit(1);
  }
}

if (import.meta.main) {
  void seed();
}
