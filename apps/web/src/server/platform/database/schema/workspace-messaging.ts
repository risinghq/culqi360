// Notifications and WhatsApp. A queued row (queue_state, claimable_at) is
// sent by the workspace's alarm; the store runs one request at a time, so a
// row needs no lease to keep two senders apart.
export const WORKSPACE_MESSAGING: readonly string[] = [
  `create table user_channel_addresses (
    id uuid primary key not null,
    user_id uuid not null references members(user_id) on delete cascade,
    channel text not null,
    address text not null,
    is_verified boolean not null default 0,
    verified_at timestamptz,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    unique (user_id, channel),
    unique (channel, address)
  )`,

  `create table notification_opt_outs (
    id uuid primary key not null,
    user_id uuid not null references members(user_id) on delete cascade,
    category text not null,
    channel text not null,
    created_at timestamptz not null,
    unique (user_id, category, channel)
  )`,
  `create index idx_notification_opt_outs_category_user on notification_opt_outs (category, user_id)`,

  `create table notification_intents (
    id text primary key not null,
    event_type text not null,
    audience_json json not null,
    channels_json json not null,
    title text not null,
    body_text text not null,
    action_url text,
    priority text not null,
    queue_state text not null default 'pending',
    attempt_count integer not null default 0,
    max_attempts integer not null default 5,
    claimable_at timestamptz not null,
    error_message text,
    created_at timestamptz not null,
    completed_at timestamptz
  )`,
  `create index idx_notification_intents_claim on notification_intents (claimable_at) where queue_state in ('pending', 'processing')`,

  `create table notification_deliveries (
    id uuid primary key not null,
    intent_id text not null,
    user_id uuid not null,
    channel text not null,
    recipient_address text not null,
    title text not null,
    body_text text not null,
    action_url text,
    queue_state text not null default 'pending',
    attempt_count integer not null default 0,
    max_attempts integer not null default 5,
    claimable_at timestamptz not null,
    provider text,
    provider_message_id text,
    error_code text,
    error_message text,
    created_at timestamptz not null,
    completed_at timestamptz,
    unique (intent_id, user_id, channel)
  )`,
  `create index idx_notification_deliveries_claim on notification_deliveries (claimable_at) where queue_state in ('pending', 'processing')`,

  `create table app_notifications (
    id uuid primary key not null,
    user_id uuid not null references members(user_id) on delete cascade,
    intent_id text not null,
    event_type text not null,
    priority text not null,
    title text not null,
    body_text text not null,
    action_url text,
    metadata_json json,
    created_at timestamptz not null,
    read_at timestamptz,
    unique (user_id, intent_id)
  )`,
  `create index idx_app_notifications_user_created on app_notifications (user_id, created_at)`,

  `create table whatsapp_sessions (
    user_id uuid primary key not null references members(user_id) on delete cascade,
    expires_at timestamptz not null
  )`,

  // The platform routes a Kapso webhook here by its phone number, so a
  // delivery lands in the workspace that owns the number.
  `create table kapso_webhook_deliveries (
    idempotency_key text primary key not null,
    event_type text not null,
    payload_version text not null,
    is_batch boolean not null,
    payload_json json not null,
    received_at timestamptz not null
  )`,

  `create table whatsapp_inbound_events (
    id text primary key not null,
    delivery_key text not null references kapso_webhook_deliveries(idempotency_key),
    conversation_id text not null,
    phone_number_id text not null,
    sender_address text not null,
    body text,
    provider_timestamp timestamptz not null,
    payload_json json not null,
    queue_state text not null default 'pending',
    attempt_count integer not null default 0,
    max_attempts integer not null default 5,
    claimable_at timestamptz not null,
    outcome text,
    error_message text,
    received_at timestamptz not null,
    completed_at timestamptz
  )`,
  `create index idx_whatsapp_inbound_events_claim on whatsapp_inbound_events (claimable_at) where queue_state in ('pending', 'processing')`,

  `create table outbound_whatsapp_messages (
    id text primary key not null,
    recipient_address text not null,
    body_text text not null,
    queue_state text not null default 'pending',
    attempt_count integer not null default 0,
    max_attempts integer not null default 5,
    claimable_at timestamptz not null,
    provider text,
    provider_message_id text,
    error_code text,
    error_message text,
    created_at timestamptz not null,
    completed_at timestamptz
  )`,
  `create index idx_outbound_whatsapp_messages_claim on outbound_whatsapp_messages (claimable_at) where queue_state in ('pending', 'processing')`,
];
