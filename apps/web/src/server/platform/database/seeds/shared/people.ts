import type { Kysely, RawBuilder } from "kysely";

import type { Role } from "~/domain/auth/access/rbac";
import type {
  BranchId,
  RoleId,
  TeamId,
  UserId,
  WorkspaceId,
} from "~/domain/ids";
import { insertBatches } from "~/server/platform/database/batches";

import type {
  PlatformDatabase,
  RegistryDatabase,
  WorkspaceDatabase,
} from "../../types";

// The stores one seed stage writes: the platform, the registry, and the store
// of the workspace it fills.
export interface SeedStores {
  platform: Kysely<PlatformDatabase>;
  registry: Kysely<RegistryDatabase>;
  workspaceId: WorkspaceId;
  workspace: Kysely<WorkspaceDatabase>;
}

// One person as the seeds describe them: the account and its member row in
// one workspace. The role columns may name the role by key (roleByKey).
export interface SeedPerson {
  id: UserId | string;
  branch_id: BranchId | string;
  team_id?: TeamId | string | null;
  username: string;
  email: string;
  password_hash: string;
  password_change_required?: boolean;
  names: string;
  first_surname: string;
  second_surname: string;
  onboarding_completed_at: Date | null;
  role_id: RawBuilder<RoleId>;
  role: RawBuilder<Role>;
  is_active: boolean;
  created_at: Date;
}

// Writes each person's account and membership on the platform, then their
// member row in the workspace. The member copies the account's identity.
export async function persistSeedPeople(
  stores: Pick<SeedStores, "platform" | "workspaceId" | "workspace">,
  people: readonly SeedPerson[],
): Promise<void> {
  if (people.length === 0) {
    return;
  }
  for (const batch of insertBatches(
    people.map((person) => ({
      id: person.id,
      username: person.username,
      email: person.email,
      password_hash: person.password_hash,
      password_change_required: person.password_change_required ?? false,
      names: person.names,
      first_surname: person.first_surname,
      second_surname: person.second_surname,
      created_at: person.created_at,
    })),
  )) {
    // eslint-disable-next-line no-await-in-loop
    await stores.platform.insertInto("accounts").values(batch).execute();
  }
  for (const batch of insertBatches(
    people.map((person) => ({
      account_id: person.id,
      workspace_id: stores.workspaceId,
      created_at: person.created_at,
    })),
  )) {
    // eslint-disable-next-line no-await-in-loop
    await stores.platform.insertInto("memberships").values(batch).execute();
  }
  for (const batch of insertBatches(
    people.map((person) => ({
      user_id: person.id,
      branch_id: person.branch_id,
      team_id: person.team_id ?? null,
      role_id: person.role_id,
      role: person.role,
      executive_category: null,
      is_active: person.is_active,
      expires_at: null,
      expiry_notified_at: null,
      onboarding_completed_at: person.onboarding_completed_at,
      username: person.username,
      email: person.email,
      names: person.names,
      first_surname: person.first_surname,
      second_surname: person.second_surname,
      avatar_storage_key: null,
      created_at: person.created_at,
    })),
  )) {
    // eslint-disable-next-line no-await-in-loop
    await stores.workspace.insertInto("members").values(batch).execute();
  }
}
