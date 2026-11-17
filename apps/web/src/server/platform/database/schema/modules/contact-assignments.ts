import { sql, type Kysely } from "kysely";

import { workspaceOwned } from "../workspace-column";

export async function createTables<T>(db: Kysely<T>): Promise<void> {
  await db.schema
    .createTable("contact_assignments")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("user_id", "uuid", (col) => col.notNull().references("users.id"))
    .addColumn("contact_id", "uuid", (col) =>
      col.notNull().references("organization_people.id"),
    )
    .addColumn("assigned_at", "timestamptz", (col) => col.notNull())
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex("idx_contact_assignments_user")
    .on("contact_assignments")
    .columns(["user_id", "status"])
    .execute();

  // Contact cadence is a per-membership assignment concern, kept off the
  // identity row so the organization directory has a single writer.
  await db.schema
    .createTable("contact_cadence")
    .$call(workspaceOwned)
    .addColumn("organization_person_id", "uuid", (col) =>
      col.primaryKey().references("organization_people.id").onDelete("cascade"),
    )
    .addColumn("last_contacted_at", "timestamptz")
    .addColumn("last_contacted_by_user_id", "uuid", (col) =>
      col.references("users.id"),
    )
    .addColumn("cooldown_until", "timestamptz")
    .execute();
}
