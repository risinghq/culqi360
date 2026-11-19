import type { Selectable } from "kysely";

import type { UserId, WorkspaceId } from "~/domain/ids";
import type {
  AuthMember,
  AuthWorkspaces,
} from "~/server/auth/application/ports";
import type { PlatformExecutor } from "~/server/platform/database/executor";
import type { PlatformDatabase } from "~/server/platform/database/types";
import {
  type AccountsRepo,
  createAccountsRepo,
} from "~/server/users/repos-accounts";
import {
  createMembershipsRepo,
  type MembershipsRepo,
} from "~/server/users/repos-memberships";

type AccountRow = Selectable<PlatformDatabase["accounts"]>;

// An account seen through its member row in one workspace: who signs in, and
// the role and branch that apply there.
export type AuthIdentity = AccountRow &
  Pick<
    AuthMember,
    | "branch_id"
    | "role"
    | "role_id"
    | "is_active"
    | "expires_at"
    | "onboarding_completed_at"
  > & { workspace_id: WorkspaceId };

export function createAuthIdentities(deps: {
  accounts: AccountsRepo;
  memberships: MembershipsRepo;
  workspaces: AuthWorkspaces;
}) {
  // Without a workspace, the account's first workspace by name applies.
  async function resolve(
    account: AccountRow | undefined,
    workspaceId?: WorkspaceId,
  ): Promise<AuthIdentity | undefined> {
    if (!account) {
      return undefined;
    }
    const target =
      workspaceId ??
      (await deps.memberships.listWorkspacesForAccount(account.id))[0]?.id;
    if (!target || !(await deps.memberships.has(account.id, target))) {
      return undefined;
    }
    const member = await deps.workspaces.findMember(target, account.id);
    if (!member) {
      return undefined;
    }
    return {
      ...account,
      workspace_id: target,
      branch_id: member.branch_id,
      role: member.role,
      role_id: member.role_id,
      is_active: member.is_active,
      expires_at: member.expires_at,
      onboarding_completed_at: member.onboarding_completed_at,
    };
  }

  return {
    async findById(id: UserId, workspaceId?: WorkspaceId) {
      return resolve(await deps.accounts.findById(id), workspaceId);
    },

    async findByUsername(username: string, workspaceId?: WorkspaceId) {
      return resolve(await deps.accounts.findByUsername(username), workspaceId);
    },

    async findByEmail(email: string) {
      return resolve(await deps.accounts.findByEmail(email));
    },

    async listWorkspaceIds(id: UserId): Promise<WorkspaceId[]> {
      const rows = await deps.memberships.listWorkspacesForAccount(id);
      return rows.map((row) => row.id);
    },

    updatePassword(id: UserId, passwordHash: string) {
      return deps.accounts.updatePassword(id, passwordHash);
    },

    replaceInstallationPassword(id: UserId, passwordHash: string) {
      return deps.accounts.replaceInstallationPassword(id, passwordHash);
    },
  };
}

export type AuthIdentitiesRepo = ReturnType<typeof createAuthIdentities>;

export function createAuthIdentitiesRepo(
  db: PlatformExecutor,
  workspaces: AuthWorkspaces,
): AuthIdentitiesRepo {
  return createAuthIdentities({
    accounts: createAccountsRepo(db),
    memberships: createMembershipsRepo(db),
    workspaces,
  });
}
