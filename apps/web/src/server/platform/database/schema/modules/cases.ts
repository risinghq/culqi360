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
    .addColumn("module", "text")
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
    .addColumn("timeout", "jsonb")
    .addPrimaryKeyConstraint("case_stages_pk", ["case_type_id", "key"])
    // A role that owns a stage cannot be deleted while the stage exists.
    .addForeignKeyConstraint(
      "case_stages_owner_role_fk",
      ["workspace_id", "owner_role"],
      "workspace_roles",
      ["workspace_id", "key"],
    )
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
        .check(
          sql`kind in ('text', 'number', 'date', 'choice', 'branch', 'file')`,
        ),
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
    .addColumn("holder_user_id", "uuid", (col) =>
      col.notNull().references("users.id"),
    )
    .addColumn("values", "jsonb", (col) => col.notNull())
    .addColumn("version", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("updated_at", "timestamptz", (col) => col.notNull())
    .addColumn("deleted_at", "timestamptz")
    .execute();

  await db.schema
    .createIndex("idx_cases_holder")
    .on("cases")
    .columns(["holder_user_id", "created_at"])
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
    // Set while the stage's timeout counts; the sweep moves the stage at it.
    .addColumn("due_at", "timestamptz")
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

  await db.schema
    .createIndex("idx_case_stage_states_due")
    .on("case_stage_states")
    .column("due_at")
    .where(sql.ref("due_at"), "is not", null)
    .execute();

  // A case's history. A timeout has no actor; every other engine event has
  // one. A module action names itself and may have no actor, as when a sweep
  // acts. The subject is the user an event is about: the new holder of a
  // reassignment.
  await db.schema
    .createTable("case_events")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("case_id", "uuid", (col) =>
      col.notNull().references("cases.id").onDelete("cascade"),
    )
    .addColumn("kind", "text", (col) =>
      col
        .notNull()
        .check(
          sql`kind in ('opened', 'stage_written', 'reassigned', 'timed_out', 'action')`,
        ),
    )
    .addColumn("action", "text")
    .addColumn("detail", "jsonb")
    .addColumn("stage_key", "text")
    .addColumn("status", "text")
    .addColumn("actor_user_id", "uuid", (col) => col.references("users.id"))
    .addColumn("subject_user_id", "uuid", (col) => col.references("users.id"))
    .addColumn("at", "timestamptz", (col) => col.notNull())
    .addCheckConstraint(
      "case_events_shape",
      sql`(action is null) = (kind <> 'action') and case kind
        when 'opened' then actor_user_id is not null
        when 'stage_written' then actor_user_id is not null
          and stage_key is not null and status is not null
        when 'reassigned' then actor_user_id is not null
          and subject_user_id is not null
        when 'timed_out' then actor_user_id is null
          and stage_key is not null and status is not null
        when 'action' then true
      end`,
    )
    .execute();

  await db.schema
    .createIndex("idx_case_events_case")
    .on("case_events")
    .columns(["case_id", "at"])
    .execute();
}
