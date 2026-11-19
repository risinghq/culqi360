// How many searches and draws each member may make. A default applies to a
// branch or team; an override or grant applies to one member.
export const WORKSPACE_CAPACITY: readonly string[] = [
  `create table search_policy_defaults (
    id uuid primary key not null,
    scope_type text not null,
    scope_id uuid not null,
    period_type text not null,
    search_limit integer not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    unique (scope_type, scope_id)
  )`,

  `create table search_policy_overrides (
    id uuid primary key not null,
    user_id uuid not null references members(user_id),
    search_limit integer not null,
    effective_from timestamptz not null,
    expires_at timestamptz,
    set_by_user_id uuid not null references members(user_id),
    created_at timestamptz not null
  )`,
  `create index idx_search_policy_override_user on search_policy_overrides (user_id)`,

  `create table draw_policy_defaults (
    id uuid primary key not null,
    scope_type text not null,
    scope_id uuid not null,
    active_buffer_target integer not null,
    daily_refill_limit integer not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    unique (scope_type, scope_id)
  )`,

  `create table draw_policy_overrides (
    id uuid primary key not null,
    user_id uuid not null references members(user_id),
    active_buffer_target integer not null,
    daily_refill_limit integer not null,
    effective_from timestamptz not null,
    expires_at timestamptz,
    set_by_user_id uuid not null references members(user_id),
    created_at timestamptz not null
  )`,
  `create index idx_draw_policy_override_user on draw_policy_overrides (user_id)`,

  `create table capacity_grants (
    id uuid primary key not null,
    kind text not null check (kind in ('search', 'draw')),
    user_id uuid not null references members(user_id),
    amount integer not null,
    reason text not null,
    actor_user_id uuid not null references members(user_id),
    created_at timestamptz not null
  )`,
  `create index idx_capacity_grants_kind_user on capacity_grants (kind, user_id, created_at)`,

  `create table capacity_reservations (
    id uuid primary key not null,
    kind text not null check (kind in ('search', 'draw')),
    user_id uuid not null references members(user_id),
    amount integer not null,
    status text not null,
    reason text not null,
    created_at timestamptz not null,
    updated_at timestamptz not null
  )`,
  `create index idx_capacity_reservations_kind_user on capacity_reservations (kind, user_id, created_at)`,

  `create table capacity_commits (
    id uuid primary key not null,
    reservation_id uuid not null references capacity_reservations(id),
    amount integer not null,
    created_at timestamptz not null
  )`,
  `create index idx_capacity_commits_reservation on capacity_commits (reservation_id)`,

  `create table capacity_requests (
    id uuid primary key not null,
    user_id uuid not null references members(user_id),
    kind text not null,
    status text not null,
    requested_amount integer not null,
    reason text not null,
    decision_note text,
    reviewer_user_id uuid references members(user_id),
    created_at timestamptz not null,
    updated_at timestamptz not null,
    decided_at timestamptz
  )`,
  `create index idx_capacity_requests_user_status on capacity_requests (user_id, status)`,
];
