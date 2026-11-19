import { hashPassword } from "~/server/auth/password/password";

import { resolveInstallationPassword } from "../../shared/installation-password";
import type { SeedStores } from "../../shared/people";
import { persistInstallationManifest } from "../manifest";
import { persistBranchesAndPolicies } from "./branches-policies";

export async function persistInstallation(
  stores: SeedStores,
  seededAt: Date,
): Promise<void> {
  const realPassword = resolveInstallationPassword();
  const realPasswordHash = await hashPassword(realPassword);

  await persistBranchesAndPolicies(stores.workspace, seededAt);
  await persistInstallationManifest(stores, seededAt, realPasswordHash);
}
