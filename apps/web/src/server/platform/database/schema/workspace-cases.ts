// Configurable cases: a case type defines its stages and fields, and a case
// moves through them. Calls and visits are logged as activities against a
// campaign record, a case or a contact; the browser extension records calls.
export const WORKSPACE_CASES: readonly string[] = [
  `create table case_types (
    id uuid primary key not null,
    key text not null unique,
    name text not null,
    created_at timestamptz not null
  )`,

  `create table case_stages (
    case_type_id uuid not null references case_types(id) on delete cascade,
    key text not null,
    name text not null,
    position integer not null,
    owner_role text not null references workspace_roles(key),
    statuses json not null,
    initial_status text not null,
    gate_stage_key text,
    gate_statuses json,
    branch_field text,
    timeout json,
    primary key (case_type_id, key),
    check ((gate_stage_key is null) = (gate_statuses is null))
  )`,

  `create table case_fields (
    case_type_id uuid not null,
    stage_key text not null,
    key text not null,
    label text not null,
    kind text not null check (kind in ('text', 'number', 'date', 'choice', 'branch', 'file')),
    choices json,
    required boolean not null,
    required_when json,
    bounds json,
    amendable_while json,
    corrected_by json not null,
    position integer not null,
    primary key (case_type_id, key),
    foreign key (case_type_id, stage_key) references case_stages(case_type_id, key) on delete cascade
  )`,

  `create table cases (
    id uuid primary key not null,
    case_type_id uuid not null references case_types(id),
    organization_id uuid not null references organizations(id),
    holder_user_id uuid not null references members(user_id),
    field_values json not null,
    version integer not null default 0,
    created_at timestamptz not null,
    updated_at timestamptz not null
  )`,
  `create index idx_cases_holder on cases (holder_user_id, created_at)`,
  `create index idx_cases_type_created on cases (case_type_id, created_at)`,

  `create table case_stage_states (
    case_id uuid not null references cases(id) on delete cascade,
    case_type_id uuid not null,
    stage_key text not null,
    status text not null,
    updated_by uuid references members(user_id),
    updated_at timestamptz not null,
    due_at timestamptz,
    primary key (case_id, stage_key),
    foreign key (case_type_id, stage_key) references case_stages(case_type_id, key)
  )`,
  `create index idx_case_stage_states_queue on case_stage_states (case_type_id, stage_key, status)`,
  `create index idx_case_stage_states_due on case_stage_states (due_at) where due_at is not null`,

  `create table case_events (
    id uuid primary key not null,
    case_id uuid not null references cases(id) on delete cascade,
    kind text not null check (kind in ('opened', 'stage_written', 'reassigned', 'timed_out')),
    stage_key text,
    status text,
    actor_user_id uuid references members(user_id),
    holder_user_id uuid references members(user_id),
    at timestamptz not null,
    check (case kind
      when 'opened' then actor_user_id is not null
      when 'stage_written' then actor_user_id is not null
        and stage_key is not null and status is not null
      when 'reassigned' then actor_user_id is not null
        and holder_user_id is not null
      when 'timed_out' then actor_user_id is null
        and stage_key is not null and status is not null
    end)
  )`,
  `create index idx_case_events_case on case_events (case_id, at)`,

  `create table activity_outcomes (
    id uuid primary key not null,
    label text not null,
    channel text not null check (channel in ('call', 'visit')),
    contacted boolean,
    negotiated boolean,
    callback boolean,
    position integer not null,
    archived_at timestamptz,
    created_at timestamptz not null,
    unique (id, channel)
  )`,
  `create unique index idx_activity_outcomes_live_label on activity_outcomes (channel, label) where archived_at is null`,

  // The outcome key carries the channel, so a call never takes a visit's
  // outcome.
  `create table activities (
    id uuid primary key not null,
    channel text not null check (channel in ('call', 'visit')),
    user_id uuid not null references members(user_id),
    branch_id uuid not null references branches(id),
    organization_id uuid not null references organizations(id),
    campaign_record_id uuid references campaign_records(id) on delete set null,
    case_id uuid references cases(id) on delete set null,
    contact_id uuid references contacts(id) on delete set null,
    phone text,
    source text not null check (source in ('extension', 'manual', 'import')),
    started_at timestamptz not null,
    ended_at timestamptz,
    duration_seconds integer check (duration_seconds >= 0),
    outcome_id uuid,
    notes text,
    check ((campaign_record_id is not null) + (case_id is not null) + (contact_id is not null) <= 1),
    check (channel = 'call' or phone is null),
    check (channel = 'call' or source <> 'extension'),
    foreign key (outcome_id, channel) references activity_outcomes(id, channel)
  )`,
  `create index idx_activities_organization_started on activities (organization_id, started_at)`,
  `create index idx_activities_user_started on activities (user_id, started_at)`,
  `create index idx_activities_branch_started on activities (branch_id, started_at)`,
  `create index idx_activities_case on activities (case_id) where case_id is not null`,
  `create index idx_activities_campaign_record on activities (campaign_record_id) where campaign_record_id is not null`,

  `create table extension_handoffs (
    jti text primary key not null,
    user_id uuid not null references members(user_id),
    branch_id uuid not null references branches(id),
    auth_session_id text not null,
    organization_id uuid not null references organizations(id),
    campaign_record_id uuid references campaign_records(id) on delete cascade,
    case_id uuid references cases(id) on delete cascade,
    contact_id uuid references contacts(id) on delete cascade,
    phone text not null,
    call_id uuid unique references activities(id),
    origin text not null,
    installation_id uuid,
    installation_session_jti text,
    issued_at timestamptz not null,
    expires_at timestamptz not null,
    consumed_at timestamptz
  )`,
  `create index idx_extension_handoffs_user_expires on extension_handoffs (user_id, expires_at)`,

  `create table extension_installation_sessions (
    jti text primary key not null,
    user_id uuid not null references members(user_id),
    branch_id uuid not null references branches(id),
    auth_session_id text not null,
    installation_id uuid not null,
    refresh_token_hash text not null unique,
    issued_at timestamptz not null,
    expires_at timestamptz not null,
    revoked_at timestamptz,
    last_seen_at timestamptz,
    refreshed_at timestamptz
  )`,
  `create index idx_extension_installation_sessions_user_expires on extension_installation_sessions (user_id, expires_at)`,

  `create table extension_runtime_events (
    id text primary key not null,
    sequence integer not null,
    user_id uuid not null references members(user_id),
    branch_id uuid not null references branches(id),
    call_session_id text,
    type text not null,
    payload_json json not null,
    created_at timestamptz not null,
    received_at timestamptz not null
  )`,
  `create index idx_extension_runtime_events_user_received on extension_runtime_events (user_id, received_at)`,

  `create table extension_executive_statuses (
    user_id uuid primary key not null references members(user_id),
    branch_id uuid not null references branches(id),
    call_session_id text,
    presence_status text,
    presence_updated_at timestamptz,
    sync_health text not null,
    sync_updated_at timestamptz,
    source_event_id text,
    source_event_sequence integer
  )`,
  `create index idx_extension_executive_statuses_branch_status on extension_executive_statuses (branch_id, presence_status, presence_updated_at)`,

  `create table extension_recordings (
    id uuid primary key not null,
    call_id uuid not null unique references activities(id),
    created_at timestamptz not null,
    last_activity_at timestamptz not null,
    status text not null default 'open' check (status in ('open', 'interrupted', 'complete')),
    closed_at timestamptz,
    reported_interrupted boolean not null default 0,
    expected_segments integer,
    expected_bytes integer
  )`,
  `create index idx_extension_recordings_status_activity on extension_recordings (status, last_activity_at)`,

  `create table extension_recording_segments (
    recording_id uuid not null references extension_recordings(id) on delete cascade,
    seq integer not null,
    storage_key text not null,
    content_type text not null,
    channels text not null,
    started_at timestamptz not null,
    size_bytes integer not null,
    sha256_hex text not null,
    received_at timestamptz not null,
    primary key (recording_id, seq)
  )`,
];
