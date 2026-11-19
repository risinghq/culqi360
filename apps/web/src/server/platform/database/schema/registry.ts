// Company records fetched from SUNAT. They are public data shared by every
// workspace, so they live in one store of their own. requested_by_user_id
// names a member of some workspace, and workspace_id a platform workspace;
// neither has a foreign key here.
export const REGISTRY_MIGRATIONS: readonly (readonly string[])[] = [
  [
    `create table company_registry_record (
      id uuid primary key not null,
      document_type text not null,
      document_value text not null,
      full_name text,
      legal_name text,
      address text,
      district text,
      department text,
      contributor_status text,
      contributor_condition text,
      economic_activities_json json,
      payload_json json,
      source text,
      fetched_at timestamptz,
      expires_at timestamptz,
      queue_state text not null default 'pending',
      attempt_count integer not null default 0,
      max_attempts integer not null default 5,
      claimable_at timestamptz not null,
      completed_at timestamptz,
      error_message text,
      requested_by_user_id uuid,
      requested_at timestamptz not null,
      unique (document_type, document_value)
    )`,
    `create index idx_company_registry_record_claim on company_registry_record (claimable_at) where queue_state in ('pending', 'processing')`,
    // The workspaces that asked for a record. A settled scrape updates the
    // organization in each of them, so a refresh one workspace asks for also
    // reaches the others that hold the company.
    `create table company_registry_subscriptions (
      record_id uuid not null references company_registry_record(id) on delete cascade,
      workspace_id uuid not null,
      subscribed_at timestamptz not null,
      primary key (record_id, workspace_id)
    )`,
  ],
];
