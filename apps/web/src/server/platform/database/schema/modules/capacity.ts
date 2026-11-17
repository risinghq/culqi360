import { sql, type Kysely } from "kysely";

import { workspaceOwned } from "../workspace-column";

export async function createTables<T>(db: Kysely<T>): Promise<void> {
  await db.schema
    .createTable("search_policy_defaults")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("scope_type", "text", (col) => col.notNull())
    .addColumn("scope_id", "uuid", (col) => col.notNull())
    .addColumn("period_type", "text", (col) => col.notNull())
    .addColumn("search_limit", "integer", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("updated_at", "timestamptz", (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex("idx_search_policy_scope")
    .unique()
    .on("search_policy_defaults")
    .columns(["workspace_id", "scope_type", "scope_id"])
    .execute();

  await db.schema
    .createTable("search_policy_overrides")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("user_id", "uuid", (col) => col.notNull().references("users.id"))
    .addColumn("search_limit", "integer", (col) => col.notNull())
    .addColumn("effective_from", "timestamptz", (col) => col.notNull())
    .addColumn("expires_at", "timestamptz")
    .addColumn("set_by_user_id", "uuid", (col) =>
      col.notNull().references("users.id"),
    )
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex("idx_search_policy_override_user")
    .on("search_policy_overrides")
    .column("user_id")
    .execute();

  await db.schema
    .createTable("lead_policy_defaults")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("scope_type", "text", (col) => col.notNull())
    .addColumn("scope_id", "uuid", (col) => col.notNull())
    .addColumn("active_buffer_target", "integer", (col) => col.notNull())
    .addColumn("daily_refill_limit", "integer", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("updated_at", "timestamptz", (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex("idx_lead_policy_scope")
    .unique()
    .on("lead_policy_defaults")
    .columns(["workspace_id", "scope_type", "scope_id"])
    .execute();

  await db.schema
    .createTable("lead_policy_overrides")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("user_id", "uuid", (col) => col.notNull().references("users.id"))
    .addColumn("active_buffer_target", "integer", (col) => col.notNull())
    .addColumn("daily_refill_limit", "integer", (col) => col.notNull())
    .addColumn("effective_from", "timestamptz", (col) => col.notNull())
    .addColumn("expires_at", "timestamptz")
    .addColumn("set_by_user_id", "uuid", (col) =>
      col.notNull().references("users.id"),
    )
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex("idx_lead_policy_override_user")
    .on("lead_policy_overrides")
    .column("user_id")
    .execute();

  // One ledger serves every capacity kind: grants add to a user's allowance,
  // reservations hold part of it during an operation, and commits record what
  // the operation used.
  await db.schema
    .createTable("capacity_grants")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("kind", "text", (col) =>
      col.notNull().check(sql`kind in ('search', 'lead')`),
    )
    .addColumn("user_id", "uuid", (col) => col.notNull().references("users.id"))
    .addColumn("amount", "integer", (col) => col.notNull())
    .addColumn("reason", "text", (col) => col.notNull())
    .addColumn("actor_user_id", "uuid", (col) =>
      col.notNull().references("users.id"),
    )
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex("idx_capacity_grants_kind_user")
    .on("capacity_grants")
    .columns(["kind", "user_id", "created_at"])
    .execute();

  await db.schema
    .createTable("capacity_reservations")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("kind", "text", (col) =>
      col.notNull().check(sql`kind in ('search', 'lead')`),
    )
    .addColumn("user_id", "uuid", (col) => col.notNull().references("users.id"))
    .addColumn("amount", "integer", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("reason", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("updated_at", "timestamptz", (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex("idx_capacity_reservations_kind_user")
    .on("capacity_reservations")
    .columns(["kind", "user_id", "created_at"])
    .execute();

  await db.schema
    .createTable("capacity_commits")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("reservation_id", "uuid", (col) =>
      col.notNull().references("capacity_reservations.id"),
    )
    .addColumn("amount", "integer", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex("idx_capacity_commits_reservation")
    .on("capacity_commits")
    .column("reservation_id")
    .execute();

  await db.schema
    .createTable("capacity_requests")
    .$call(workspaceOwned)
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("user_id", "uuid", (col) => col.notNull().references("users.id"))
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("requested_amount", "integer", (col) => col.notNull())
    .addColumn("reason", "text", (col) => col.notNull())
    .addColumn("decision_note", "text")
    .addColumn("reviewer_user_id", "uuid", (col) => col.references("users.id"))
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("updated_at", "timestamptz", (col) => col.notNull())
    .addColumn("decided_at", "timestamptz")
    .execute();

  await db.schema
    .createIndex("idx_capacity_requests_user_status")
    .on("capacity_requests")
    .columns(["user_id", "status"])
    .execute();
}
