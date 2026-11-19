import type { SeedContext } from "../shared/context";
import type { SeedStores } from "../shared/people";
import { compileWorkflowScenario } from "./compiler";
import { persistEntelWorkspace, type OpenSeedWorkspace } from "./entel";
import { persistDemoMerchantStats } from "./merchant-stats/persist";
import { persistWorkflowSample as persistDemoSeed } from "./persist/core";
import { persistDemoIdentities } from "./persist/identities";

export async function runDemoIdentitiesSeedStage(
  stores: SeedStores,
  context: SeedContext,
): Promise<void> {
  await persistDemoIdentities(stores, context);
}

export async function runDemoWorkflowSeedStage(
  stores: SeedStores,
  context: SeedContext,
): Promise<void> {
  const compiled = compileWorkflowScenario(context.anchorDate.getTime());
  await persistDemoSeed(stores, compiled);
}

export async function runDemoMerchantStatsSeedStage(
  stores: SeedStores,
  context: SeedContext,
): Promise<void> {
  await stores.workspace
    .transaction()
    .execute((trx) => persistDemoMerchantStats(trx, context));
}

export async function runDemoEntelSeedStage(
  stores: Omit<SeedStores, "workspaceId" | "workspace">,
  openWorkspace: OpenSeedWorkspace,
  context: SeedContext,
): Promise<void> {
  await persistEntelWorkspace(stores, openWorkspace, context);
}
