import { sql, type Kysely } from "kysely";

import { workspaceOwned } from "../workspace-column";

export async function createTables<T>(db: Kysely<T>): Promise<void> {
  await db.schema
    .createTable("campaigns")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addUniqueConstraint("campaigns_workspace_name", ["workspace_id", "name"])
    .execute();

  // A record holds what the campaign file said about one company. Identity
  // stays on organizations and holders on campaign_holds, so a reload
  // rewrites only the file's facts.
  await db.schema
    .createTable("campaign_records")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("campaign_id", "uuid", (col) =>
      col.notNull().references("campaigns.id").onDelete("cascade"),
    )
    .addColumn("organization_id", "uuid", (col) =>
      col.notNull().references("organizations.id"),
    )
    .addColumn("segment", "text", (col) => col.notNull())
    .addColumn("facts", "jsonb", (col) => col.notNull())
    .addColumn("imported_at", "timestamptz", (col) => col.notNull())
    .addColumn("worked_at", "timestamptz")
    .addUniqueConstraint("campaign_records_natural_key", [
      "campaign_id",
      "organization_id",
      "segment",
    ])
    .execute();

  await db.schema
    .createIndex("idx_campaign_records_pool")
    .on("campaign_records")
    .columns(["campaign_id", "segment", "id"])
    .where(sql.ref("worked_at"), "is", null)
    .execute();

  // A release closes the row instead of deleting it, so a batch drawn and
  // never worked leaves a trace.
  await db.schema
    .createTable("campaign_holds")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("record_id", "uuid", (col) =>
      col.notNull().references("campaign_records.id").onDelete("cascade"),
    )
    .addColumn("user_id", "uuid", (col) => col.notNull().references("users.id"))
    .addColumn("held_at", "timestamptz", (col) => col.notNull())
    .addColumn("released_at", "timestamptz")
    .execute();

  // One holder per record at a time, enforced by the database.
  await db.schema
    .createIndex("idx_campaign_holds_one_holder")
    .on("campaign_holds")
    .column("record_id")
    .unique()
    .where(sql.ref("released_at"), "is", null)
    .execute();

  await db.schema
    .createIndex("idx_campaign_holds_holder")
    .on("campaign_holds")
    .column("user_id")
    .where(sql.ref("released_at"), "is", null)
    .execute();
}
