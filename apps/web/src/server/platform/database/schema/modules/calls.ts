import { sql, type Kysely } from "kysely";

import { workspaceOwned } from "../workspace-column";

export async function createTables<T>(db: Kysely<T>): Promise<void> {
  // One row per phone call with a company, whatever dialled it. The subject
  // says what the call worked on: a campaign record, a case, or a contact
  // person. A call with no subject still belongs to the company, so the
  // company history lists every call.
  await db.schema
    .createTable("calls")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
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
    .addColumn("organization_person_id", "uuid", (col) =>
      col.references("organization_people.id").onDelete("set null"),
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
    .addColumn("outcome", "text")
    .addColumn("notes", "text")
    .addCheckConstraint(
      "calls_one_subject",
      sql`num_nonnulls(campaign_record_id, case_id, organization_person_id) <= 1`,
    )
    .execute();

  await db.schema
    .createIndex("idx_calls_organization_started")
    .on("calls")
    .columns(["organization_id", "started_at"])
    .execute();

  await db.schema
    .createIndex("idx_calls_user_started")
    .on("calls")
    .columns(["user_id", "started_at"])
    .execute();

  await db.schema
    .createIndex("idx_calls_case")
    .on("calls")
    .column("case_id")
    .where(sql.ref("case_id"), "is not", null)
    .execute();

  await db.schema
    .createIndex("idx_calls_campaign_record")
    .on("calls")
    .column("campaign_record_id")
    .where(sql.ref("campaign_record_id"), "is not", null)
    .execute();
}
