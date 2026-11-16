import { sql, type Kysely } from "kysely";

import { WorkspaceId } from "~/domain/ids";
import { createLogger } from "~/shared/observability/runtime-logger";

import { db as globalDb } from "./db";
import {
  runDemoIdentitiesSeedStage,
  runDemoMerchantStatsSeedStage,
  runDemoWorkflowSeedStage,
} from "./seeds/demo";
import {
  provisionInstallation,
  verifyInstallation,
} from "./seeds/installation";
import { createSeedContext } from "./seeds/shared/context";
import { stableSeedId } from "./seeds/shared/stable-id";
import type { Database } from "./types";
import { runAsPlatform, WORKSPACE_SETTING } from "./workspace-scope";

const logger = createLogger("db-seed");

// The installation's workspace. Its first client is Culqi.
export const INSTALLATION_WORKSPACE_ID = WorkspaceId.trust(
  stableSeedId("workspace:culqi"),
);

export function seedIfEmpty(db: Kysely<Database>): Promise<void> {
  return runAsPlatform(() => seedAsPlatform(db));
}

async function seedAsPlatform(db: Kysely<Database>): Promise<void> {
  const existingUser = await db
    .selectFrom("users")
    .select("id")
    .limit(1)
    .executeTakeFirst();

  if (existingUser) {
    await verifyInstallation(db);
    logger.info("seed_skipped_already_initialized");
    return;
  }

  logger.info("seed_started");
  const context = createSeedContext();
  const includeDemoFixtures = process.env.NODE_ENV !== "production";

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("workspaces")
      .values({
        id: INSTALLATION_WORKSPACE_ID,
        name: "Culqi",
        modules: ["culqi", "contacts"],
        created_at: context.anchorDate,
      })
      .execute();
    // Transaction-local, so the column defaults tag every seeded row with the
    // workspace while the owner role keeps bypassing the policies.
    await sql`select set_config(${WORKSPACE_SETTING}, ${INSTALLATION_WORKSPACE_ID}, true)`.execute(
      trx,
    );

    await provisionInstallation(trx, context.anchorDate);

    if (includeDemoFixtures) {
      await runDemoIdentitiesSeedStage(trx, context);
      await runDemoWorkflowSeedStage(trx, context);
      await runDemoMerchantStatsSeedStage(trx, context);
    }
  });

  logger.info("seed_completed");
}

async function seed() {
  try {
    await seedIfEmpty(globalDb);
    process.exit(0);
  } catch (err) {
    logger.error("seed_failed", { error: err });
    process.exit(1);
  }
}

if (import.meta.main) {
  void seed();
}
