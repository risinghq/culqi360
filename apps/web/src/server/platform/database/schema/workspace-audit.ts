import { EPOCH, quote } from "./literal";

// Actions the audit log always records at high risk. An admin cannot turn
// them off or lower them.
const PROTECTED_HIGH_RISK_ACTIONS = [
  "product_updated",
  "search_allowance_granted",
  "draw_refill_granted",
  "rate_limit_exceeded",
];

// What happened in the workspace and who did it. Request timings and sign-in
// funnels go to the Worker's logs, not here: they are written on every
// request, and the store's daily write allowance is for the work itself.
export const WORKSPACE_AUDIT: readonly string[] = [
  `create table events (
    id uuid primary key not null,
    entity_type text not null,
    entity_id text not null,
    type text not null,
    actor_user_id uuid references members(user_id),
    subject_user_id uuid references members(user_id),
    payload_json json,
    changes_json json,
    occurred_at timestamptz not null
  )`,
  `create index idx_events_occurred on events (occurred_at)`,
  `create index idx_events_type_occurred on events (type, occurred_at)`,
  `create index idx_events_actor_occurred on events (actor_user_id, occurred_at)`,
  `create index idx_events_entity_occurred on events (entity_type, entity_id, occurred_at)`,

  `create table audit_action_policies (
    action text primary key not null,
    risk_level text not null,
    is_active boolean not null default 1,
    is_protected boolean not null default 0,
    updated_by_user_id uuid references members(user_id),
    created_at timestamptz not null,
    updated_at timestamptz not null
  )`,
  `create index idx_audit_policy_risk_active on audit_action_policies (risk_level, is_active)`,
  `insert into audit_action_policies (action, risk_level, is_active, is_protected, created_at, updated_at)
   values ${PROTECTED_HIGH_RISK_ACTIONS.map((action) => `(${quote(action)}, 'high', 1, 1, ${EPOCH}, ${EPOCH})`).join(", ")}`,

  // Limits on actions inside the workspace, beside the events that record a
  // block, so a limited action stays in one store.
  `create table action_rate_limit_counters (
    id uuid primary key not null,
    key_hash text not null unique,
    window_started_at timestamptz not null,
    request_count integer not null,
    updated_at timestamptz not null
  )`,
  `create index idx_action_rate_limit_updated_at on action_rate_limit_counters (updated_at)`,
];
