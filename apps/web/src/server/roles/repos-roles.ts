import type { Permission, Role } from "~/domain/auth/access/rbac";
import { RoleId } from "~/domain/ids";
import { insertBatches } from "~/server/platform/database/batches";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";

const ROLE_COLUMNS = [
  "id",
  "key",
  "name",
  "kind",
  "permissions",
  "locked",
] as const;

export function createRolesRepo(db: WorkspaceExecutor) {
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
            .selectFrom("members")
            .select((count) => count.fn.countAll<string>().as("n"))
            .whereRef("members.role_id", "=", "workspace_roles.id")
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
          id: RoleId.mint(),
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
      for (const batch of insertBatches(
        assignableIds.map((assignableId) => ({
          role_id: id,
          assignable_role_id: assignableId,
        })),
      )) {
        // eslint-disable-next-line no-await-in-loop
        await db
          .insertInto("workspace_role_assignables")
          .values(batch)
          .execute();
      }
    },

    async countMembers(id: RoleId): Promise<number> {
      const row = await db
        .selectFrom("members")
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
