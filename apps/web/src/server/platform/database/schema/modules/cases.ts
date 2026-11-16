import { sql, type Kysely } from "kysely";

import { workspaceOwned } from "../workspace-column";

// A case type is workspace configuration: its stages and fields are rows, and
// cases/domain/definition.ts checks them as a whole when they are written.
export async function createTables<T>(db: Kysely<T>): Promise<void> {
  await db.schema
    .createTable("case_types")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("key", "text", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addUniqueConstraint("case_types_workspace_key", ["workspace_id", "key"])
    .execute();

  await db.schema
    .createTable("case_stages")
    .$call(workspaceOwned)
    .addColumn("case_type_id", "uuid", (col) =>
      col.notNull().references("case_types.id").onDelete("cascade"),
    )
    .addColumn("key", "text", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("position", "integer", (col) => col.notNull())
    .addColumn("owner_role", "text", (col) => col.notNull())
    .addColumn("statuses", sql`text[]`, (col) => col.notNull())
    .addColumn("initial_status", "text", (col) => col.notNull())
    .addColumn("gate_stage_key", "text")
    .addColumn("gate_statuses", sql`text[]`)
    .addColumn("branch_field", "text")
    .addPrimaryKeyConstraint("case_stages_pk", ["case_type_id", "key"])
    .addCheckConstraint(
      "case_stages_gate_complete",
      sql`(gate_stage_key is null) = (gate_statuses is null)`,
    )
    .execute();

  await db.schema
    .createTable("case_fields")
    .$call(workspaceOwned)
    .addColumn("case_type_id", "uuid", (col) => col.notNull())
    .addColumn("stage_key", "text", (col) => col.notNull())
    .addColumn("key", "text", (col) => col.notNull())
    .addColumn("label", "text", (col) => col.notNull())
    .addColumn("kind", "text", (col) =>
      col
        .notNull()
        .check(sql`kind in ('text', 'number', 'date', 'choice', 'branch')`),
    )
    .addColumn("choices", sql`text[]`)
    .addColumn("required", "boolean", (col) => col.notNull())
    .addColumn("required_when", "jsonb")
    .addColumn("bounds", "jsonb")
    .addColumn("amendable_while", "jsonb")
    .addColumn("corrected_by", sql`text[]`, (col) => col.notNull())
    .addColumn("position", "integer", (col) => col.notNull())
    .addPrimaryKeyConstraint("case_fields_pk", ["case_type_id", "key"])
    .addForeignKeyConstraint(
      "case_fields_stage",
      ["case_type_id", "stage_key"],
      "case_stages",
      ["case_type_id", "key"],
      (fk) => fk.onDelete("cascade"),
    )
    .execute();

  await db.schema
    .createTable("cases")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("case_type_id", "uuid", (col) =>
      col.notNull().references("case_types.id"),
    )
    .addColumn("organization_id", "uuid", (col) =>
      col.notNull().references("organizations.id"),
    )
    .addColumn("owner_user_id", "uuid", (col) =>
      col.notNull().references("users.id"),
    )
    .addColumn("values", "jsonb", (col) => col.notNull())
    .addColumn("version", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("updated_at", "timestamptz", (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex("idx_cases_owner")
    .on("cases")
    .columns(["owner_user_id", "created_at"])
    .execute();

  await db.schema
    .createTable("case_stage_states")
    .$call(workspaceOwned)
    .addColumn("case_id", "uuid", (col) =>
      col.notNull().references("cases.id").onDelete("cascade"),
    )
    .addColumn("case_type_id", "uuid", (col) => col.notNull())
    .addColumn("stage_key", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("updated_by", "uuid", (col) => col.references("users.id"))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull())
    .addPrimaryKeyConstraint("case_stage_states_pk", ["case_id", "stage_key"])
    .addForeignKeyConstraint(
      "case_stage_states_stage",
      ["case_type_id", "stage_key"],
      "case_stages",
      ["case_type_id", "key"],
    )
    .execute();

  // A stage's work queue: the cases waiting in one status of one stage.
  await db.schema
    .createIndex("idx_case_stage_states_queue")
    .on("case_stage_states")
    .columns(["case_type_id", "stage_key", "status"])
    .execute();
}
