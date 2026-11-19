import { EPOCH } from "./literal";

// Culqi's merchant GPV report. An upload becomes a snapshot; one snapshot is
// active at a time, and the views read only the active one. A date column ends
// in _on and a timestamp in _at, because a column name has one kind across the
// store.
export const WORKSPACE_MERCHANT_STATS: readonly string[] = [
  `create table merchant_gpv_dataset (
    id text primary key not null check (id = 'default'),
    updated_at timestamptz not null
  )`,
  `insert into merchant_gpv_dataset (id, updated_at) values ('default', ${EPOCH})`,

  `create table gpv_snapshots (
    id uuid primary key not null,
    file_asset_id uuid not null unique references file_assets(id),
    cut_at timestamptz not null,
    revision integer not null check (revision > 0),
    state text not null default 'queued' check (state in ('queued', 'processing', 'needs_review', 'ready', 'active', 'superseded', 'rejected', 'failed')),
    uploaded_at timestamptz not null,
    activated_by uuid references members(user_id),
    activated_at timestamptz,
    unique (cut_at, revision),
    check (
      (state in ('active', 'superseded') and activated_by is not null and activated_at is not null)
      or (state not in ('active', 'superseded') and activated_by is null and activated_at is null)
    )
  )`,
  `create unique index idx_gpv_snapshots_one_active on gpv_snapshots (state) where state = 'active'`,

  `create table gpv_snapshot_jobs (
    id uuid primary key not null,
    snapshot_id uuid not null unique references gpv_snapshots(id) on delete cascade,
    queue_state text not null default 'pending',
    rows_total integer,
    rows_applied integer,
    rows_failed integer,
    results_json json,
    error_message text,
    attempt_count integer not null default 0,
    max_attempts integer not null default 3,
    claimable_at timestamptz not null,
    created_at timestamptz not null,
    completed_at timestamptz
  )`,
  `create index idx_gpv_snapshot_jobs_claim on gpv_snapshot_jobs (claimable_at) where queue_state in ('pending', 'processing')`,

  `create table gpv_snapshot_placements (
    id uuid primary key not null,
    snapshot_id uuid not null references gpv_snapshots(id) on delete cascade,
    row_number integer not null,
    placement_key text not null,
    merchant_id text not null,
    product text not null,
    serial_number text,
    ruc text not null,
    sold_on date not null,
    sale_month date not null check (sale_month = date(sale_month, 'start of month')),
    trade_name text,
    legal_name text,
    culqi_user_code text,
    culqi_user_name text,
    mesa text,
    channel text,
    subchannel text,
    offer_amount numeric,
    promotion text,
    client_type text,
    stock_type text,
    trial_on date,
    activated_on date,
    last_transaction_on date,
    m0_plus_15d_gpv numeric,
    m0_plus_15d_trx integer,
    raw json not null,
    unique (snapshot_id, placement_key),
    unique (id, snapshot_id)
  )`,
  `create index idx_gpv_snapshot_placements_ruc on gpv_snapshot_placements (snapshot_id, ruc)`,

  `create table gpv_snapshot_observations (
    snapshot_id uuid not null references gpv_snapshots(id) on delete cascade,
    placement_id uuid not null,
    month_offset integer not null check (month_offset between 0 and 3),
    sale_month date not null check (sale_month = date(sale_month, 'start of month')),
    realized_month date generated always as (date(sale_month, '+' || month_offset || ' months')) stored,
    gpv numeric not null,
    trx integer not null,
    primary key (snapshot_id, placement_id, month_offset),
    foreign key (placement_id, snapshot_id) references gpv_snapshot_placements(id, snapshot_id) on delete cascade
  ) without rowid`,
  `create index idx_gpv_snapshot_observations_month on gpv_snapshot_observations (snapshot_id, realized_month)`,

  `create table gpv_snapshot_issues (
    id uuid primary key not null,
    snapshot_id uuid not null references gpv_snapshots(id) on delete cascade,
    issue_key text not null,
    issue_type text not null,
    entity_key text,
    severity text not null check (severity in ('warning', 'blocking')),
    status text not null default 'open' check (status in ('open', 'resolved')),
    detail text not null,
    previous_value json,
    candidate_value json,
    resolution text check (resolution in ('accept_candidate', 'keep_previous', 'exclude_candidate', 'reject_snapshot')),
    resolved_by uuid references members(user_id),
    resolved_at timestamptz,
    created_at timestamptz not null,
    unique (snapshot_id, issue_key),
    check (
      (status = 'open' and resolution is null and resolved_by is null and resolved_at is null)
      or (status = 'resolved' and resolution is not null and resolved_by is not null and resolved_at is not null)
    )
  )`,

  `create table merchant_month_credits (
    ruc text not null,
    month date not null check (month = date(month, 'start of month')),
    organization_id uuid not null references organizations(id),
    seller_user_id uuid not null references members(user_id),
    branch_id uuid references branches(id),
    first_snapshot_id uuid not null references gpv_snapshots(id),
    credited_at timestamptz not null,
    primary key (ruc, month)
  ) without rowid`,

  `create table merchant_month_credit_adjustments (
    id uuid primary key not null,
    ruc text not null,
    month date not null check (month = date(month, 'start of month')),
    seller_user_id uuid references members(user_id),
    branch_id uuid references branches(id),
    reason text not null,
    adjusted_by uuid not null references members(user_id),
    adjusted_at timestamptz not null
  )`,
  `create index idx_merchant_month_credit_adjustments_latest on merchant_month_credit_adjustments (ruc, month, adjusted_at)`,

  `create table commission_scheme_versions (
    id uuid primary key not null,
    starts_on date not null unique,
    rules json not null,
    set_by uuid not null references members(user_id),
    set_at timestamptz not null
  )`,

  `create table merchant_gpv_targets (
    organization_id uuid not null references organizations(id) on delete cascade,
    starts_on date not null check (starts_on = date(starts_on, 'start of month')),
    monthly_target_gpv numeric check (monthly_target_gpv is null or monthly_target_gpv >= 0),
    set_by uuid not null references members(user_id),
    set_at timestamptz not null,
    primary key (organization_id, starts_on)
  ) without rowid`,

  `create view merchant_sales as
   select placement.id, placement.merchant_id, placement.product,
          placement.serial_number, placement.ruc, placement.sold_on,
          placement.sale_month, placement.trade_name, placement.legal_name,
          placement.culqi_user_code, placement.culqi_user_name, placement.mesa,
          placement.channel, placement.subchannel, placement.offer_amount,
          placement.promotion, placement.client_type, placement.stock_type,
          placement.trial_on, placement.activated_on,
          placement.last_transaction_on, placement.m0_plus_15d_gpv,
          placement.m0_plus_15d_trx
     from gpv_snapshots snapshot
     join gpv_snapshot_placements placement on placement.snapshot_id = snapshot.id
    where snapshot.state = 'active'`,

  `create view merchant_sale_gpv as
   select observation.placement_id as sale_id, observation.month_offset,
          observation.sale_month, observation.realized_month,
          observation.gpv, observation.trx
     from gpv_snapshots snapshot
     join gpv_snapshot_observations observation on observation.snapshot_id = snapshot.id
    where snapshot.state = 'active'`,

  `create view merchant_monthly_gpv as
   select placement.ruc, observation.realized_month as month,
          sum(observation.gpv) as gpv, sum(observation.trx) as trx,
          count(distinct placement.id) as device_count
     from gpv_snapshots snapshot
     join gpv_snapshot_placements placement on placement.snapshot_id = snapshot.id
     join gpv_snapshot_observations observation
       on observation.snapshot_id = placement.snapshot_id
      and observation.placement_id = placement.id
    where snapshot.state = 'active'
    group by placement.ruc, observation.realized_month`,

  // The latest adjustment for a merchant month overrides the credit that the
  // CRM owner earned.
  `create view merchant_month_credit as
   with latest as (
     select adjustment.*,
            row_number() over (
              partition by adjustment.ruc, adjustment.month
              order by adjustment.adjusted_at desc, adjustment.id desc
            ) as rank
       from merchant_month_credit_adjustments adjustment
   )
   select credit.ruc, credit.month, credit.organization_id,
          case when latest.id is null then credit.seller_user_id else latest.seller_user_id end as seller_user_id,
          case when latest.id is null then credit.branch_id else latest.branch_id end as branch_id,
          case when latest.id is null then 'crm_owner' else 'manual' end as method,
          case when latest.id is null then 'exact'
               when latest.seller_user_id is null then 'none'
               else 'exact' end as confidence,
          credit.first_snapshot_id,
          credit.credited_at as derived_at,
          latest.adjusted_by as resolved_by,
          latest.adjusted_at as resolved_at
     from merchant_month_credits credit
     left join latest
       on latest.ruc = credit.ruc and latest.month = credit.month and latest.rank = 1`,
];
