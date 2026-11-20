import type { SeedStores } from "../shared/people";
import { persistInstallation } from "./persist/core";

export async function provisionInstallation(
  stores: SeedStores,
  seededAt: Date,
): Promise<void> {
  await persistInstallation(stores, seededAt);
}

// The installation has no people of its own, so this runs after the stage that
// adds them.
export async function verifyInstallation(
  stores: Pick<SeedStores, "workspace">,
): Promise<void> {
  const administrator = await stores.workspace
    .selectFrom("members")
    .select("user_id")
    .where("is_active", "=", true)
    .where("role", "in", ["admin", "superuser"])
    .limit(1)
    .executeTakeFirst();
  if (!administrator) {
    throw new Error("installation_has_no_active_administrator");
  }
}
