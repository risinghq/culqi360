// The platform store: who a person is, how they sign in, and which workspaces
// they belong to. What a person does inside a workspace lives in that
// workspace's store. Ids and timestamps come from the code that writes the row.
export const PLATFORM_MIGRATIONS: readonly (readonly string[])[] = [
  [
    `create table workspaces (
      id uuid primary key not null,
      name text not null,
      created_at timestamptz not null
    )`,

    // Kapso posts every inbound message to one webhook; the receiving number
    // says which workspace store takes it.
    `create table whatsapp_numbers (
      phone_number_id text primary key not null,
      workspace_id uuid not null references workspaces(id) on delete cascade
    )`,

    // An operator creates workspaces and enters any of them for support. What
    // a person may do inside a workspace is that workspace's role, never this.
    `create table accounts (
      id uuid primary key not null,
      username text not null collate nocase unique,
      email text not null collate nocase unique,
      password_hash text not null,
      password_change_required boolean not null default 0,
      is_operator boolean not null default 0,
      names text not null,
      first_surname text not null,
      second_surname text not null,
      avatar_storage_key text,
      avatar_mime_type text,
      avatar_updated_at timestamptz,
      avatar_version integer not null default 0,
      created_at timestamptz not null
    )`,

    // The platform checks a membership before it forwards a request to the
    // workspace's store. The member's role and branch live there.
    `create table memberships (
      account_id uuid not null references accounts(id) on delete cascade,
      workspace_id uuid not null references workspaces(id) on delete cascade,
      created_at timestamptz not null,
      primary key (account_id, workspace_id)
    ) without rowid`,
    `create index idx_memberships_workspace on memberships (workspace_id)`,

    // An invite is the whole draft of a member: who they are and where they
    // go. Nothing exists in either store until it is accepted, and the
    // workspace store checks the placement then. Only the token's hash is
    // kept, so a link is shown once and resending issues a new one.
    `create table invites (
      id uuid primary key not null,
      workspace_id uuid not null references workspaces(id) on delete cascade,
      email text not null collate nocase,
      names text not null,
      first_surname text not null,
      second_surname text not null,
      branch_id uuid not null,
      team_id uuid,
      role_id uuid not null,
      executive_category text,
      token_hash text not null unique,
      status text not null,
      expires_at timestamptz not null,
      created_by_account_id uuid not null references accounts(id),
      accepted_account_id uuid references accounts(id) on delete set null,
      accepted_at timestamptz,
      revoked_at timestamptz,
      created_at timestamptz not null,
      last_delivered_at timestamptz
    )`,
    `create unique index idx_invites_pending_email on invites (workspace_id, email) where status = 'pending'`,
    `create index idx_invites_workspace_branch_status on invites (workspace_id, branch_id, status, created_at)`,

    // A session works in one workspace at a time, so a request routes to that
    // workspace's store without a lookup. Ending a membership ends the
    // sessions in it.
    `create table user_sessions (
      id text primary key not null,
      account_id uuid not null references accounts(id) on delete cascade,
      workspace_id uuid not null,
      session_class text not null,
      primary_auth_method text not null,
      strong_auth_method text,
      impersonator_account_id uuid references accounts(id) on delete cascade,
      strong_auth_at timestamptz,
      ip_address text,
      user_agent text,
      created_at timestamptz not null,
      last_activity timestamptz not null,
      expires_at timestamptz not null,
      foreign key (account_id, workspace_id)
        references memberships(account_id, workspace_id) on delete cascade
    )`,
    `create index idx_user_sessions_membership on user_sessions (account_id, workspace_id)`,
    `create index idx_user_sessions_account_activity on user_sessions (account_id, last_activity)`,
    `create index idx_user_sessions_expires_at on user_sessions (expires_at)`,

    `create table request_sessions (
      id text primary key not null,
      csrf_token text not null,
      created_at timestamptz not null,
      last_activity timestamptz not null,
      expires_at timestamptz not null
    )`,
    `create index idx_request_sessions_expires_at on request_sessions (expires_at)`,

    `create table auth_throttle_counters (
      id uuid primary key not null,
      scope text not null,
      key_hash text not null,
      window_started_at timestamptz not null,
      failure_count integer not null,
      blocked_until timestamptz,
      updated_at timestamptz not null,
      unique (scope, key_hash)
    )`,
    `create index idx_auth_throttle_blocked_until on auth_throttle_counters (blocked_until)`,
    `create index idx_auth_throttle_updated_at on auth_throttle_counters (updated_at)`,

    `create table auth_events (
      id uuid primary key not null,
      account_id uuid references accounts(id) on delete set null,
      method text not null,
      stage text not null,
      outcome text not null,
      reason text,
      identifier_hash text not null,
      ip_hash text not null,
      created_at timestamptz not null
    )`,
    `create index idx_auth_events_account_created on auth_events (account_id, created_at)`,
    `create index idx_auth_events_identifier_created on auth_events (identifier_hash, created_at)`,
    `create index idx_auth_events_outcome_created on auth_events (outcome, created_at)`,

    // The audit trail of what changes an account or a membership: passwords,
    // factors, sessions, invites, support entry. Sign-in attempts are
    // auth_events; what happens inside a workspace is that store's events.
    `create table platform_events (
      id uuid primary key not null,
      workspace_id uuid references workspaces(id) on delete cascade,
      entity_type text not null,
      entity_id text not null,
      type text not null,
      actor_account_id uuid references accounts(id) on delete set null,
      subject_account_id uuid references accounts(id) on delete set null,
      payload_json json,
      occurred_at timestamptz not null
    )`,
    `create index idx_platform_events_subject_occurred on platform_events (subject_account_id, occurred_at)`,
    `create index idx_platform_events_workspace_occurred on platform_events (workspace_id, occurred_at)`,

    `create table passkeys (
      id text primary key not null,
      account_id uuid not null references accounts(id) on delete cascade,
      public_key text not null,
      counter integer not null,
      transports text,
      created_at timestamptz not null,
      last_used_at timestamptz
    )`,
    `create index idx_passkeys_account on passkeys (account_id)`,

    `create table webauthn_challenges (
      id uuid primary key not null,
      account_id uuid references accounts(id) on delete cascade,
      type text not null,
      challenge text not null,
      expires_at timestamptz not null,
      created_at timestamptz not null
    )`,

    `create table user_totp_factors (
      id uuid primary key not null,
      account_id uuid not null unique references accounts(id) on delete cascade,
      secret_encrypted text not null,
      is_enabled boolean not null default 0,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      enabled_at timestamptz
    )`,

    `create table recovery_code_set (
      id uuid primary key not null,
      account_id uuid not null references accounts(id) on delete cascade,
      source text not null,
      created_at timestamptz not null,
      acknowledged_at timestamptz,
      revoked_at timestamptz
    )`,
    // One active set per account: a new set inserts only after the prior one
    // is revoked, so "the active set" is never ambiguous.
    `create unique index uq_recovery_code_set_active_account on recovery_code_set (account_id) where revoked_at is null`,

    // Redemption looks codes up by (set, hash), so the unique index is both
    // the lookup path and the guard against a duplicate hash in one set.
    `create table recovery_code (
      id uuid primary key not null,
      set_id uuid not null references recovery_code_set(id) on delete cascade,
      code_hash text not null,
      used_at timestamptz,
      unique (set_id, code_hash)
    )`,
    `create index idx_recovery_code_set_used on recovery_code (set_id, used_at)`,

    `create table user_oauth_accounts (
      id uuid primary key not null,
      account_id uuid not null references accounts(id) on delete cascade,
      provider text not null,
      provider_user_id text not null,
      email text not null,
      created_at timestamptz not null,
      unique (provider, provider_user_id)
    )`,

    `create table login_flows (
      id uuid primary key not null,
      identifier text not null,
      primary_auth_method text not null,
      account_id uuid references accounts(id) on delete cascade,
      challenge_id uuid references webauthn_challenges(id) on delete cascade,
      state text not null,
      expires_at timestamptz not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )`,
    `create index idx_login_flows_expires_at on login_flows (expires_at)`,

    `create table password_reset_tokens (
      id uuid primary key not null,
      account_id uuid not null references accounts(id) on delete cascade,
      token_hash text not null unique,
      expires_at timestamptz not null,
      used_at timestamptz,
      created_at timestamptz not null
    )`,
    `create index idx_password_reset_tokens_account_expires on password_reset_tokens (account_id, expires_at)`,
  ],
];
