import { sql, type Kysely } from "kysely";

import { APP_ROLE, WORKSPACE_SETTING } from "../../workspace-scope";

// Tables without a workspace_id column. Each holds platform data: the
// workspace list, auth state looked up before a workspace is known, shared
// reference data, the public company registry, or inbound webhooks that are
// routed to a workspace after they arrive. The build fails when a table has
// no workspace_id and is missing here, so a new table is classified when it
// is added.
export const GLOBAL_TABLES = [
  "workspaces",
  "schema_integrity",
  "user_sessions",
  "request_sessions",
  "auth_throttle_counters",
  "auth_events",
  "passkeys",
  "webauthn_challenges",
  "user_totp_factors",
  "recovery_code_set",
  "recovery_code",
  "user_oauth_accounts",
  "login_flows",
  "password_reset_tokens",
  "action_rate_limit_counters",
  "workflow_collection_mode_kinds",
  "workflow_currency_kinds",
  "workflow_account_type_kinds",
  "workflow_settlement_banks",
  "audit_action_policies",
  "company_registry_record",
  "merchant_gpv_dataset",
  "kapso_webhook_deliveries",
  "whatsapp_inbound_events",
] as const;

export type GlobalTable = (typeof GLOBAL_TABLES)[number];

export function isGlobalTable(table: string): table is GlobalTable {
  return (GLOBAL_TABLES as readonly string[]).includes(table);
}

// Tables whose workspace_id is null for platform rows. See workspaceTagged.
// Each lists its user columns in order of preference. A row written at
// platform scope, by an anonymous flow or a sweep, takes the workspace of the
// first listed user that is set; a row with no user stays a platform row.
export const WORKSPACE_TAGGED_TABLES = {
  events: ["subject_user_id", "actor_user_id"],
  action_observations: ["actor_user_id"],
  auth_funnel_events: [],
  agent_status_logs: ["user_id"],
} as const satisfies Record<string, readonly string[]>;

export type WorkspaceTaggedTable = keyof typeof WORKSPACE_TAGGED_TABLES;

// Runs after every other module, so it sees the finished table list.
export async function createTables<T>(db: Kysely<T>): Promise<void> {
  // The role is cluster-wide, so another database may have created it. The
  // connecting user must be a member to switch to it; a superuser already is.
  await sql`
    do $$
    begin
      create role ${sql.id(APP_ROLE)} nologin;
    exception when duplicate_object then null;
    end
    $$
  `.execute(db);
  await sql`
    do $$
    begin
      if not pg_has_role(current_user, ${sql.lit(APP_ROLE)}, 'member') then
        execute format('grant %I to %I', ${sql.lit(APP_ROLE)}, current_user);
      end if;
    end
    $$
  `.execute(db);

  const tables = await sql<{ table_name: string; owned: boolean }>`
    select t.table_name,
           exists (
             select 1 from information_schema.columns c
             where c.table_schema = t.table_schema
               and c.table_name = t.table_name
               and c.column_name = 'workspace_id'
           ) as owned
    from information_schema.tables t
    where t.table_schema = current_schema() and t.table_type = 'BASE TABLE'
  `.execute(db);

  const unclassified = tables.rows
    .filter((row) => !row.owned && !isGlobalTable(row.table_name))
    .map((row) => row.table_name);
  if (unclassified.length > 0) {
    throw new Error(
      `Tables without workspace_id must be listed in GLOBAL_TABLES: ${unclassified.join(", ")}`,
    );
  }

  // The app role does not own the tables, so the policies bind it while the
  // owner, which builds the schema and runs platform work, bypasses them.
  for (const { table_name: table } of tables.rows.filter((row) => row.owned)) {
    // eslint-disable-next-line no-await-in-loop
    await sql`alter table ${sql.table(table)} enable row level security`.execute(
      db,
    );
    // eslint-disable-next-line no-await-in-loop
    await sql`
      create policy workspace_isolation on ${sql.table(table)}
      using (workspace_id = nullif(current_setting(${sql.lit(WORKSPACE_SETTING)}, true), '')::uuid)
      with check (workspace_id = nullif(current_setting(${sql.lit(WORKSPACE_SETTING)}, true), '')::uuid)
    `.execute(db);
  }

  // A view runs with its owner's rights by default, which would skip the
  // policies of the tables it reads.
  const views = await sql<{ table_name: string }>`
    select table_name from information_schema.views
    where table_schema = current_schema()
  `.execute(db);
  for (const { table_name: view } of views.rows) {
    // eslint-disable-next-line no-await-in-loop
    await sql`alter view ${sql.table(view)} set (security_invoker = true)`.execute(
      db,
    );
  }

  await sql`
    create function workspace_from_user() returns trigger
    language plpgsql as $$
    declare
      user_column text;
    begin
      foreach user_column in array tg_argv loop
        exit when new.workspace_id is not null;
        select workspace_id into new.workspace_id
        from users
        where id = (to_jsonb(new) ->> user_column)::uuid;
      end loop;
      return new;
    end
    $$
  `.execute(db);
  for (const [table, userColumns] of Object.entries(WORKSPACE_TAGGED_TABLES)) {
    if (userColumns.length === 0) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await sql`
      create trigger workspace_from_user before insert on ${sql.table(table)}
      for each row execute function workspace_from_user(${sql.join(
        userColumns.map((column) => sql.lit(column)),
      )})
    `.execute(db);
  }

  await sql`grant usage on schema public to ${sql.id(APP_ROLE)}`.execute(db);
  await sql`
    grant select, insert, update, delete on all tables in schema public
    to ${sql.id(APP_ROLE)}
  `.execute(db);
  await sql`
    grant usage, select on all sequences in schema public to ${sql.id(APP_ROLE)}
  `.execute(db);
}
