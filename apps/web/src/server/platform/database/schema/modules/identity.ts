import { sql, type Kysely } from "kysely";

import { workspaceOwned } from "../workspace-column";

export async function createTables<T>(db: Kysely<T>): Promise<void> {
  // A workspace's roles. `kind` is one of the eight structural roles in
  // rbac.ts; `permissions` is what the workspace's admin granted.
  await db.schema
    .createTable("workspace_roles")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("key", "text", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("permissions", sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'`),
    )
    .addColumn("locked", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addUniqueConstraint("workspace_roles_key_unique", ["workspace_id", "key"])
    .addUniqueConstraint("workspace_roles_kind_unique", [
      "workspace_id",
      "id",
      "kind",
    ])
    .execute();

  // The roles a role's holders may assign. The admin and superuser kinds
  // assign every role but superuser without rows here.
  await db.schema
    .createTable("workspace_role_assignables")
    .$call(workspaceOwned)
    .addColumn("role_id", "uuid", (col) =>
      col.notNull().references("workspace_roles.id").onDelete("cascade"),
    )
    .addColumn("assignable_role_id", "uuid", (col) =>
      col.notNull().references("workspace_roles.id").onDelete("cascade"),
    )
    .addPrimaryKeyConstraint("workspace_role_assignables_pk", [
      "role_id",
      "assignable_role_id",
    ])
    .execute();

  await db.schema
    .createTable("users")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("branch_id", "uuid", (col) =>
      col.notNull().references("branches.id"),
    )
    .addColumn("team_id", "uuid", (col) => col.references("teams.id"))
    .addColumn("username", "text", (col) => col.notNull().unique())
    .addColumn("email", "text", (col) => col.notNull().unique())
    .addColumn("password_hash", "text", (col) => col.notNull())
    .addColumn("password_change_required", "boolean", (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn("names", "text", (col) => col.notNull())
    .addColumn("first_surname", "text", (col) => col.notNull())
    .addColumn("second_surname", "text", (col) => col.notNull())
    .addColumn("avatar_storage_key", "text")
    .addColumn("avatar_mime_type", "text")
    .addColumn("avatar_updated_at", "timestamptz")
    .addColumn("avatar_version", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("onboarding_completed_at", "timestamptz")
    .addColumn("role_id", "uuid", (col) => col.notNull())
    .addColumn("role", "text", (col) => col.notNull())
    .addColumn("executive_category", "text")
    .addColumn("is_active", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("expires_at", "timestamptz")
    .addColumn("expiry_notified_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    // `role` copies the role's kind for the code that reads structure from
    // it. The key keeps the copy equal and the role in the user's workspace,
    // which a plain foreign key would not, since foreign keys bypass RLS.
    .addForeignKeyConstraint(
      "users_role_fk",
      ["workspace_id", "role_id", "role"],
      "workspace_roles",
      ["workspace_id", "id", "kind"],
    )
    .execute();

  await db.schema
    .createIndex("idx_users_email")
    .on("users")
    .column("email")
    .execute();

  await db.schema
    .createIndex("idx_users_onboarding")
    .on("users")
    .column("onboarding_completed_at")
    .execute();

  await db.schema
    .createTable("branch_supervisors")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("branch_id", "uuid", (col) =>
      col.notNull().references("branches.id"),
    )
    .addColumn("user_id", "uuid", (col) => col.notNull().references("users.id"))
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addUniqueConstraint("idx_branch_supervisors_unique", [
      "branch_id",
      "user_id",
    ])
    .execute();

  await db.schema
    .createTable("back_office_assignments")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("back_office_user_id", "uuid", (col) =>
      col.notNull().references("users.id"),
    )
    .addColumn("team_id", "uuid", (col) => col.notNull().references("teams.id"))
    .addColumn("assigned_at", "timestamptz", (col) => col.notNull())
    .addUniqueConstraint("idx_back_office_assignments_unique", [
      "back_office_user_id",
      "team_id",
    ])
    .execute();
}
