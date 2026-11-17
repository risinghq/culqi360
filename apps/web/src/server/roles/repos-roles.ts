import type { Permission, Role } from "~/domain/auth/access/rbac";
import type { RoleId } from "~/domain/ids";
import type { DatabaseExecutor } from "~/server/platform/database/executor";

const ROLE_COLUMNS = [
  "id",
  "key",
  "name",
  "kind",
  "permissions",
  "locked",
] as const;

export function createRolesRepo(db: DatabaseExecutor) {
  return {
    findById(id: RoleId) {
      return db
        .selectFrom("workspace_roles")
        .select(ROLE_COLUMNS)
        .where("id", "=", id)
        .executeTakeFirst();
    },

    findByKey(key: string) {
      return db
        .selectFrom("workspace_roles")
        .select(ROLE_COLUMNS)
        .where("key", "=", key)
        .executeTakeFirst();
    },

    list() {
      return db
        .selectFrom("workspace_roles")
        .select(ROLE_COLUMNS)
        .select((eb) =>
          eb
            .selectFrom("users")
            .select((count) => count.fn.countAll<string>().as("n"))
            .whereRef("users.role_id", "=", "workspace_roles.id")
            .as("member_count"),
        )
        .orderBy("created_at")
        .orderBy("key")
        .execute();
    },

    async listAssignableIds(id: RoleId): Promise<RoleId[]> {
      const rows = await db
        .selectFrom("workspace_role_assignables")
        .select("assignable_role_id")
        .where("role_id", "=", id)
        .execute();
      return rows.map((row) => row.assignable_role_id);
    },

    async create(input: {
      key: string;
      name: string;
      kind: Role;
      permissions: readonly Permission[];
      createdAt: Date;
    }): Promise<RoleId> {
      const row = await db
        .insertInto("workspace_roles")
        .values({
          key: input.key,
          name: input.name,
          kind: input.kind,
          permissions: [...input.permissions],
          created_at: input.createdAt,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return row.id;
    },

    async update(
      id: RoleId,
      input: { name: string; permissions: readonly Permission[] },
    ): Promise<void> {
      await db
        .updateTable("workspace_roles")
        .set({ name: input.name, permissions: [...input.permissions] })
        .where("id", "=", id)
        .execute();
    },

    async setAssignableIds(
      id: RoleId,
      assignableIds: readonly RoleId[],
    ): Promise<void> {
      await db
        .deleteFrom("workspace_role_assignables")
        .where("role_id", "=", id)
        .execute();
      if (assignableIds.length === 0) {
        return;
      }
      await db
        .insertInto("workspace_role_assignables")
        .values(
          assignableIds.map((assignableId) => ({
            role_id: id,
            assignable_role_id: assignableId,
          })),
        )
        .execute();
    },

    async countMembers(id: RoleId): Promise<number> {
      const row = await db
        .selectFrom("users")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("role_id", "=", id)
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },

    async countOwnedStages(key: string): Promise<number> {
      const row = await db
        .selectFrom("case_stages")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("owner_role", "=", key)
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },

    async delete(id: RoleId): Promise<void> {
      await db.deleteFrom("workspace_roles").where("id", "=", id).execute();
    },
  };
}

export type RolesRepo = ReturnType<typeof createRolesRepo>;
