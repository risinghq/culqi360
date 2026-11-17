import { sql, type Kysely } from "kysely";

import { workspaceOwned } from "../workspace-column";

export async function createTables<T>(db: Kysely<T>): Promise<void> {
  // The results a workspace records on its calls and visits. An admin edits
  // the list; an outcome in use is archived, never deleted, so old activities
  // keep their result. A null flag means the outcome does not say.
  await db.schema
    .createTable("activity_outcomes")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("label", "text", (col) => col.notNull())
    .addColumn("channel", "text", (col) =>
      col.notNull().check(sql`channel in ('call', 'visit')`),
    )
    .addColumn("contacted", "boolean")
    .addColumn("negotiated", "boolean")
    .addColumn("callback", "boolean")
    .addColumn("position", "integer", (col) => col.notNull())
    .addColumn("archived_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    // The target of the activity's outcome key, which holds the channel.
    .addUniqueConstraint("activity_outcomes_id_channel", ["id", "channel"])
    .execute();

  await db.schema
    .createIndex("idx_activity_outcomes_live_label")
    .on("activity_outcomes")
    .columns(["workspace_id", "channel", "label"])
    .unique()
    .where(sql.ref("archived_at"), "is", null)
    .execute();

  // One row per call or visit with a company, however it was logged. The
  // subject says what it worked on: a campaign record, a case, or a contact
  // person. An activity with no subject still belongs to the company, so the
  // company history lists every one.
  await db.schema
    .createTable("activities")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("channel", "text", (col) =>
      col.notNull().check(sql`channel in ('call', 'visit')`),
    )
    .addColumn("user_id", "uuid", (col) => col.notNull().references("users.id"))
    .addColumn("branch_id", "uuid", (col) =>
      col.notNull().references("branches.id"),
    )
    .addColumn("organization_id", "uuid", (col) =>
      col.notNull().references("organizations.id"),
    )
    .addColumn("campaign_record_id", "uuid", (col) =>
      col.references("campaign_records.id").onDelete("set null"),
    )
    .addColumn("case_id", "uuid", (col) =>
      col.references("cases.id").onDelete("set null"),
    )
    .addColumn("contact_id", "uuid", (col) =>
      col.references("contacts.id").onDelete("set null"),
    )
    // Null when the number is unknown, as on a logged or imported call.
    .addColumn("phone", "text")
    .addColumn("source", "text", (col) =>
      col.notNull().check(sql`source in ('extension', 'manual', 'import')`),
    )
    .addColumn("started_at", "timestamptz", (col) => col.notNull())
    .addColumn("ended_at", "timestamptz")
    .addColumn("duration_seconds", "integer", (col) =>
      col.check(sql`duration_seconds >= 0`),
    )
    // Null until the user records the result.
    .addColumn("outcome_id", "uuid")
    .addColumn("notes", "text")
    .addCheckConstraint(
      "activities_one_subject",
      sql`num_nonnulls(campaign_record_id, case_id, contact_id) <= 1`,
    )
    .addCheckConstraint(
      "activities_phone_on_call",
      sql`channel = 'call' or phone is null`,
    )
    .addCheckConstraint(
      "activities_extension_on_call",
      sql`channel = 'call' or source <> 'extension'`,
    )
    // The outcome must be one of the activity's channel.
    .addForeignKeyConstraint(
      "activities_outcome_fkey",
      ["outcome_id", "channel"],
      "activity_outcomes",
      ["id", "channel"],
    )
    .execute();

  await db.schema
    .createIndex("idx_activities_organization_started")
    .on("activities")
    .columns(["organization_id", "started_at"])
    .execute();

  await db.schema
    .createIndex("idx_activities_user_started")
    .on("activities")
    .columns(["user_id", "started_at"])
    .execute();

  await db.schema
    .createIndex("idx_activities_case")
    .on("activities")
    .column("case_id")
    .where(sql.ref("case_id"), "is not", null)
    .execute();

  await db.schema
    .createIndex("idx_activities_campaign_record")
    .on("activities")
    .column("campaign_record_id")
    .where(sql.ref("campaign_record_id"), "is not", null)
    .execute();
}
