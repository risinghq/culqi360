import type { WorkspaceModule } from "~/domain/auth/access/workspace-modules";
import type { ExecutiveCategory } from "~/domain/identity/executive-category";
import type { BranchId, RoleId, TeamId, UserId } from "~/domain/ids";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { MembersTable } from "~/server/platform/database/types";
import { readWorkspaceModules } from "~/server/roles/workspace-settings";

type MemberRole = MembersTable["role"];

type MemberNameRow = {
  user_id: UserId;
  names: string;
  first_surname: string;
  second_surname: string;
};

export type MemberRosterRow = {
  user_id: UserId;
  names: string;
  first_surname: string;
  second_surname: string;
  email: string;
  role: MemberRole;
  executive_category: ExecutiveCategory | null;
  is_active: boolean;
  avatar_storage_key: string | null;
  avatar_version: number;
  expires_at: Date | null;
  onboarding_completed_at: Date | null;
  team_id: TeamId | null;
  team_name: string | null;
};

// What a session needs from the member, read as it stands now so a change to
// the role's permissions applies on the next request.
export interface SessionMember {
  user_id: UserId;
  branch_id: BranchId;
  is_active: boolean;
  onboarding_completed_at: Date | null;
  expires_at: Date | null;
  role: MemberRole;
  role_id: RoleId;
  role_key: string;
  role_name: string;
  role_permissions: string[];
  assignable_role_ids: RoleId[];
  modules: WorkspaceModule[];
}

// The account's identity fields this workspace keeps a copy of.
export interface MemberIdentity {
  username: string;
  email: string;
  names: string;
  first_surname: string;
  second_surname: string;
  avatar_storage_key: string | null;
  avatar_version: number;
}

export interface MemberPlacementValues {
  branch_id: BranchId;
  team_id: TeamId | null;
  role_id: RoleId;
  role: MemberRole;
  executive_category: ExecutiveCategory | null;
  expires_at: Date | null;
}

// Workspace store. A member row outlives its membership: records keep their
// owner, so leaving a workspace deactivates the row instead of deleting it.
export function createMembersRepo(db: WorkspaceExecutor) {
  return {
    findById(userId: UserId) {
      return db
        .selectFrom("members")
        .selectAll()
        .where("user_id", "=", userId)
        .executeTakeFirst();
    },

    // Emails are stored lowercased, so the caller passes a normalized one.
    async hasActiveWithEmail(email: string): Promise<boolean> {
      const row = await db
        .selectFrom("members")
        .select("user_id")
        .where("email", "=", email)
        .where("is_active", "=", true)
        .executeTakeFirst();
      return row !== undefined;
    },

    async findForSession(userId: UserId): Promise<SessionMember | undefined> {
      const member = await db
        .selectFrom("members")
        .select([
          "user_id",
          "branch_id",
          "is_active",
          "onboarding_completed_at",
          "expires_at",
          "role",
          "role_id",
        ])
        .where("user_id", "=", userId)
        .executeTakeFirst();
      if (!member) {
        return undefined;
      }

      // Selected by its own column names, so the codec decodes permissions.
      const role = await db
        .selectFrom("workspace_roles")
        .select(["key", "name", "permissions"])
        .where("id", "=", member.role_id)
        .executeTakeFirstOrThrow();
      const assignable = await db
        .selectFrom("workspace_role_assignables")
        .select("assignable_role_id")
        .where("role_id", "=", member.role_id)
        .execute();

      return {
        ...member,
        role_key: role.key,
        role_name: role.name,
        role_permissions: role.permissions,
        assignable_role_ids: assignable.map((row) => row.assignable_role_id),
        modules: await readWorkspaceModules(db),
      };
    },

    findByIds(userIds: readonly UserId[]): Promise<MemberNameRow[]> {
      if (userIds.length === 0) {
        return Promise.resolve([]);
      }

      return db
        .selectFrom("members")
        .select(["user_id", "names", "first_surname", "second_surname"])
        .where("user_id", "in", userIds)
        .execute();
    },

    async findPlacements(
      userIds: readonly UserId[],
    ): Promise<ReadonlyMap<UserId, { role: MemberRole; branchName: string }>> {
      if (userIds.length === 0) {
        return new Map();
      }

      const rows = await db
        .selectFrom("members")
        .innerJoin("branches", "branches.id", "members.branch_id")
        .select(["members.user_id", "members.role", "branches.name"])
        .where("members.user_id", "in", userIds)
        .execute();

      return new Map(
        rows.map((row) => [
          row.user_id,
          { role: row.role, branchName: row.name },
        ]),
      );
    },

    findAssignableExecutives(input: {
      branchId?: BranchId;
      search?: string;
      limit: number;
    }): Promise<MemberNameRow[]> {
      let query = db
        .selectFrom("members")
        .select(["user_id", "names", "first_surname", "second_surname"])
        .where("role", "=", "executive")
        .where("is_active", "=", true)
        .where("onboarding_completed_at", "is not", null);

      if (input.branchId != null) {
        query = query.where("branch_id", "=", input.branchId);
      }

      const term = input.search?.trim().toLowerCase();

      if (term) {
        const pattern = `%${term}%`;

        query = query.where((eb) =>
          eb.or([
            eb(eb.fn("lower", ["names"]), "like", pattern),
            eb(eb.fn("lower", ["first_surname"]), "like", pattern),
            eb(eb.fn("lower", ["second_surname"]), "like", pattern),
          ]),
        );
      }

      return query
        .orderBy("names", "asc")
        .orderBy("first_surname", "asc")
        .orderBy("second_surname", "asc")
        .limit(input.limit)
        .execute();
    },

    findByBranchIncludingInactive(branchId: BranchId) {
      return db
        .selectFrom("members")
        .selectAll()
        .where("branch_id", "=", branchId)
        .execute();
    },

    findByTeam(teamId: TeamId) {
      return db
        .selectFrom("members")
        .selectAll()
        .where("team_id", "=", teamId)
        .execute();
    },

    findByBranch(branchId: BranchId) {
      return db
        .selectFrom("members")
        .selectAll()
        .where("branch_id", "=", branchId)
        .where("is_active", "=", true)
        .execute();
    },

    findActiveIdsByBranchAndRoles(
      branchId: BranchId,
      roles: readonly MemberRole[],
    ): Promise<Array<{ user_id: UserId }>> {
      if (roles.length === 0) {
        return Promise.resolve([]);
      }

      return db
        .selectFrom("members")
        .select("user_id")
        .where("branch_id", "=", branchId)
        .where("is_active", "=", true)
        .where("onboarding_completed_at", "is not", null)
        .where("role", "in", roles)
        .execute();
    },

    findAllActive() {
      return db
        .selectFrom("members")
        .selectAll()
        .where("is_active", "=", true)
        .execute();
    },

    listByBranchWithTeam(branchId: BranchId): Promise<MemberRosterRow[]> {
      return db
        .selectFrom("members")
        .leftJoin("teams", "teams.id", "members.team_id")
        .select([
          "members.user_id",
          "members.names",
          "members.first_surname",
          "members.second_surname",
          "members.email",
          "members.role",
          "members.executive_category",
          "members.is_active",
          "members.avatar_storage_key",
          "members.avatar_version",
          "members.expires_at",
          "members.onboarding_completed_at",
          "members.team_id",
          "teams.name as team_name",
        ])
        .where("members.branch_id", "=", branchId)
        .orderBy("members.is_active", "desc")
        .orderBy("members.names", "asc")
        .orderBy("members.first_surname", "asc")
        .execute();
    },

    // An accepted invite places the account here; a former member returning
    // takes the new placement and becomes active again.
    async upsertActive(
      userId: UserId,
      values: MemberPlacementValues & MemberIdentity & { created_at: Date },
    ): Promise<void> {
      const { created_at: _joinedAt, ...current } = values;
      await db
        .insertInto("members")
        .values({
          ...values,
          user_id: userId,
          is_active: true,
          expiry_notified_at: null,
          onboarding_completed_at: null,
        })
        .onConflict((oc) =>
          oc.column("user_id").doUpdateSet({
            ...current,
            is_active: true,
            expiry_notified_at: null,
          }),
        )
        .execute();
    },

    async updateIdentity(
      userId: UserId,
      values: Partial<MemberIdentity>,
    ): Promise<void> {
      await db
        .updateTable("members")
        .set(values)
        .where("user_id", "=", userId)
        .execute();
    },

    async updateProfile(
      userId: UserId,
      values: {
        names: string;
        first_surname: string;
        second_surname: string;
        team_id: TeamId | null;
        executive_category: ExecutiveCategory | null;
      },
    ): Promise<void> {
      await db
        .updateTable("members")
        .set(values)
        .where("user_id", "=", userId)
        .execute();
    },

    async updateRole(
      userId: UserId,
      values: {
        role_id: RoleId;
        role: MemberRole;
        executive_category: ExecutiveCategory | null;
      },
    ): Promise<void> {
      await db
        .updateTable("members")
        .set(values)
        .where("user_id", "=", userId)
        .execute();
    },

    async setActive(userId: UserId, isActive: boolean): Promise<void> {
      await db
        .updateTable("members")
        .set({ is_active: isActive })
        .where("user_id", "=", userId)
        .execute();
    },

    async updateExpiry(userId: UserId, expiresAt: Date | null): Promise<void> {
      await db
        .updateTable("members")
        .set({ expires_at: expiresAt, expiry_notified_at: null })
        .where("user_id", "=", userId)
        .execute();
    },

    async completeOnboarding(
      userId: UserId,
      values: { completedAt: Date },
    ): Promise<void> {
      await db
        .updateTable("members")
        .set({ onboarding_completed_at: values.completedAt })
        .where("user_id", "=", userId)
        .execute();
    },

    findActiveIdsExpiringBefore(expiredBefore: Date) {
      return db
        .selectFrom("members")
        .select("user_id")
        .where("expires_at", "<=", expiredBefore)
        .where("is_active", "=", true)
        .execute();
    },

    async deactivateIfExpired(
      userId: UserId,
      expiredAsOf: Date,
    ): Promise<boolean> {
      const result = await db
        .updateTable("members")
        .set({ is_active: false })
        .where("user_id", "=", userId)
        .where("is_active", "=", true)
        .where("expires_at", "is not", null)
        .where("expires_at", "<=", expiredAsOf)
        .executeTakeFirst();

      return Number(result.numUpdatedRows ?? 0) > 0;
    },

    findExpiringBefore(threshold: Date) {
      return db
        .selectFrom("members")
        .selectAll()
        .where("expires_at", "<=", threshold)
        .where("expires_at", "is not", null)
        .where("expiry_notified_at", "is", null)
        .where("is_active", "=", true)
        .execute();
    },

    async claimExpiryReminder(
      userId: UserId,
      threshold: Date,
      claimedAt: Date,
    ): Promise<boolean> {
      const result = await db
        .updateTable("members")
        .set({ expiry_notified_at: claimedAt })
        .where("user_id", "=", userId)
        .where("is_active", "=", true)
        .where("expires_at", "is not", null)
        .where("expires_at", "<=", threshold)
        .where("expiry_notified_at", "is", null)
        .executeTakeFirst();

      return Number(result.numUpdatedRows ?? 0) > 0;
    },

    async releaseExpiryReminderClaim(
      userId: UserId,
      claimedAt: Date,
    ): Promise<void> {
      await db
        .updateTable("members")
        .set({ expiry_notified_at: null })
        .where("user_id", "=", userId)
        .where("expiry_notified_at", "=", claimedAt)
        .execute();
    },

    async nextExpiryAt(): Promise<Date | null> {
      const row = await db
        .selectFrom("members")
        .select("expires_at")
        .where("expires_at", "is not", null)
        .where("is_active", "=", true)
        .orderBy("expires_at")
        .limit(1)
        .executeTakeFirst();
      return row?.expires_at ?? null;
    },

    async nextUnnotifiedExpiryAt(): Promise<Date | null> {
      const row = await db
        .selectFrom("members")
        .select("expires_at")
        .where("expires_at", "is not", null)
        .where("expiry_notified_at", "is", null)
        .where("is_active", "=", true)
        .orderBy("expires_at")
        .limit(1)
        .executeTakeFirst();
      return row?.expires_at ?? null;
    },

    async markExpiryNotified(userId: UserId, notifiedAt: Date): Promise<void> {
      await db
        .updateTable("members")
        .set({ expiry_notified_at: notifiedAt })
        .where("user_id", "=", userId)
        .execute();
    },
  };
}

export type MembersRepo = ReturnType<typeof createMembersRepo>;
