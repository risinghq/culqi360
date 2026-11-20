import { generateUsername } from "~/domain/identity/generate-username";
import { hashPassword } from "~/server/auth/password/password";
import { roleByKey } from "~/server/roles/role-ref";

import { resolveInstallationPassword } from "../shared/installation-password";
import { persistSeedPeople, type SeedStores } from "../shared/people";
import { stableSeedId } from "../shared/stable-id";
import { INFINITY_BRANCH_ID } from "./persist/branches-policies";

// The one account a production installation starts with. It invites everyone
// else from the application.
export interface InstallationAdmin {
  email: string;
  names: string;
  firstSurname: string;
  password: string;
}

function requiredEnv(name: string): string {
  const found = process.env[name]?.trim();
  if (!found) {
    throw new Error(`missing_${name.toLowerCase()}`);
  }
  return found;
}

export function resolveInstallationAdmin(): InstallationAdmin {
  return {
    email: requiredEnv("INSTALLATION_ADMIN_EMAIL"),
    names: requiredEnv("INSTALLATION_ADMIN_NAMES"),
    firstSurname: requiredEnv("INSTALLATION_ADMIN_SURNAME"),
    password: resolveInstallationPassword(),
  };
}

// Returns the username, which the admin signs in with. The store is empty, so
// the first candidate is free.
export async function persistInstallationAdmin(
  stores: SeedStores,
  admin: InstallationAdmin,
  seededAt: Date,
): Promise<string> {
  const username = await generateUsername(
    admin.names,
    admin.firstSurname,
    "",
    async () => false,
  );
  await persistSeedPeople(stores, [
    {
      id: stableSeedId(`installation-user:${username}`),
      branch_id: INFINITY_BRANCH_ID,
      username,
      email: admin.email,
      password_hash: await hashPassword(admin.password),
      // The password passed through the provisioning shell.
      password_change_required: true,
      names: admin.names,
      first_surname: admin.firstSurname,
      second_surname: "",
      onboarding_completed_at: null,
      ...roleByKey("admin"),
      is_active: true,
      created_at: seededAt,
    },
  ]);
  return username;
}
