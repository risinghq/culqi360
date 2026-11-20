import type { SeedStores } from "../../shared/people";
import { persistBranchesAndPolicies } from "./branches-policies";

export async function persistInstallation(
  stores: SeedStores,
  seededAt: Date,
): Promise<void> {
  await persistBranchesAndPolicies(stores.workspace, seededAt);
}
