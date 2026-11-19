import {
  ACCOUNT_TYPE_KINDS,
  COLLECTION_MODES,
  CURRENCIES,
  SETTLEMENT_BANKS,
} from "~/contracts/workflow/vocabulary";

import { insertValues } from "./literal";

// The sales pipeline: a lead for a company, its rate negotiation, the venues
// and bank accounts it sells through, and the order that installs it. Rates
// and amounts are numeric, so SQLite returns them as numbers.
export const WORKSPACE_PIPELINE: readonly string[] = [
  `create table workflow_collection_mode_kinds (value text primary key not null)`,
  `create table workflow_currency_kinds (value text primary key not null)`,
  `create table workflow_account_type_kinds (value text primary key not null)`,
  `create table workflow_settlement_banks (value text primary key not null)`,
  insertValues("workflow_collection_mode_kinds", "value", COLLECTION_MODES),
  insertValues("workflow_currency_kinds", "value", CURRENCIES),
  insertValues("workflow_account_type_kinds", "value", ACCOUNT_TYPE_KINDS),
  insertValues("workflow_settlement_banks", "value", SETTLEMENT_BANKS),

  `create table workflow_leads (
    id text primary key not null,
    organization_id uuid not null references organizations(id),
    stage text not null,
    status text,
    priority text,
    created_by uuid not null references members(user_id),
    updated_by uuid references members(user_id),
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    reservation_expires_at timestamptz,
    version integer not null default 0,
    current_provider text not null,
    current_debit_rate numeric not null,
    current_credit_rate numeric not null,
    gpv numeric not null,
    ticket numeric not null,
    settlement_bank text not null references workflow_settlement_banks(value),
    pos_count integer not null
  )`,
  // A company has one live lead at a time.
  `create unique index idx_workflow_leads_organization on workflow_leads (organization_id) where deleted_at is null and stage != 'EXPIRED'`,
  `create index idx_workflow_leads_reservation on workflow_leads (reservation_expires_at) where reservation_expires_at is not null`,
  `create index idx_workflow_leads_status on workflow_leads (status)`,
  `create index idx_workflow_leads_priority on workflow_leads (priority)`,
  `create index idx_workflow_leads_stage on workflow_leads (stage)`,
  `create index idx_workflow_leads_deleted_at on workflow_leads (deleted_at)`,

  `create table workflow_inquiries (
    id text primary key not null,
    ruc text not null,
    executive_id uuid not null references members(user_id),
    state text not null default 'PENDING',
    status text,
    priority text,
    answered_at timestamptz,
    answered_by uuid references members(user_id),
    answered_by_job_id uuid,
    converted_lead_id text references workflow_leads(id),
    created_at timestamptz not null,
    updated_at timestamptz not null
  )`,
  `create unique index idx_workflow_inquiries_live_unique on workflow_inquiries (executive_id, ruc) where state != 'CONVERTED'`,
  `create index idx_workflow_inquiries_ruc on workflow_inquiries (ruc, state)`,

  `create table workflow_lead_digital_policy (
    lead_id text primary key not null references workflow_leads(id) on delete cascade,
    link_scope text not null default 'none',
    link_url text,
    online_scope text not null default 'none',
    online_url text,
    online_collection_mode text references workflow_collection_mode_kinds(value),
    updated_at timestamptz not null,
    updated_by uuid not null references members(user_id)
  )`,

  `create table workflow_lead_favorites (
    lead_id text not null references workflow_leads(id) on delete cascade,
    user_id uuid not null references members(user_id) on delete cascade,
    created_at timestamptz not null,
    primary key (lead_id, user_id)
  ) without rowid`,
  `create index idx_workflow_lead_favorites_user on workflow_lead_favorites (user_id)`,

  `create table workflow_integration_jobs (
    id uuid primary key not null,
    type text not null,
    queue_state text not null default 'pending',
    requested_by_user_id uuid not null references members(user_id),
    file_path text,
    error_message text,
    rows_total integer,
    rows_applied integer,
    rows_failed integer,
    results_json json,
    attempt_count integer not null default 0,
    max_attempts integer not null default 3,
    claimable_at timestamptz not null,
    created_at timestamptz not null,
    completed_at timestamptz
  )`,
  `create index idx_workflow_integration_jobs_claim on workflow_integration_jobs (claimable_at) where queue_state in ('pending', 'processing')`,

  `create table workflow_integration_import_rows (
    id uuid primary key not null,
    integration_job_id uuid not null references workflow_integration_jobs(id) on delete cascade,
    row_number integer not null,
    type text not null,
    ruc text not null,
    status_value text,
    prioridad_value text,
    state text not null,
    lead_id text references workflow_leads(id),
    failure_reason text,
    created_at timestamptz not null,
    applied_at timestamptz,
    unique (integration_job_id, row_number)
  )`,
  `create index idx_workflow_import_rows_job_state on workflow_integration_import_rows (integration_job_id, state, row_number)`,

  `create table workflow_sale_proof_files (
    id uuid primary key not null,
    lead_id text not null references workflow_leads(id) on delete cascade,
    file_asset_id uuid not null unique references file_assets(id) on delete cascade,
    uploaded_by_user_id uuid not null references members(user_id),
    created_at timestamptz not null
  )`,
  `create index idx_sale_proof_files_lead on workflow_sale_proof_files (lead_id, created_at)`,

  `create table workflow_rate_proposals (
    id text primary key not null,
    lead_id text not null references workflow_leads(id) on delete cascade,
    round integer not null,
    proposed_debit_rate numeric not null,
    proposed_credit_rate numeric not null,
    proposed_foreign_rate numeric not null,
    fee numeric not null,
    payback_pricing numeric not null,
    currency text not null,
    proposed_by uuid not null references members(user_id),
    proposed_at timestamptz not null,
    outcome text not null,
    decided_at timestamptz,
    unique (lead_id, round)
  )`,

  `create table workflow_rate_proposal_policies (
    branch_id uuid primary key not null references branches(id) on delete cascade,
    validity_days integer not null,
    updated_at timestamptz not null,
    updated_by_user_id uuid not null references members(user_id)
  )`,

  `create table workflow_pending_quotation_policies (
    branch_id uuid primary key not null references branches(id) on delete cascade,
    client_limit integer not null,
    updated_at timestamptz not null,
    updated_by_user_id uuid not null references members(user_id)
  )`,

  `create table workflow_rate_revisions (
    id text primary key not null,
    lead_id text not null references workflow_leads(id) on delete cascade,
    proposal_id text not null references workflow_rate_proposals(id) on delete cascade,
    round integer not null,
    justification text not null,
    requested_by uuid not null references members(user_id),
    requested_at timestamptz not null,
    unique (lead_id, round)
  )`,

  // A file uploaded before its revision is sent has no revision_id yet.
  `create table workflow_rate_revision_files (
    id uuid primary key not null,
    lead_id text not null references workflow_leads(id) on delete cascade,
    revision_id text references workflow_rate_revisions(id) on delete cascade,
    file_asset_id uuid not null unique references file_assets(id) on delete cascade,
    uploaded_by_user_id uuid not null references members(user_id),
    created_at timestamptz not null
  )`,
  `create index idx_rate_revision_files_revision on workflow_rate_revision_files (revision_id, created_at)`,
  `create index idx_rate_revision_files_staged on workflow_rate_revision_files (lead_id, uploaded_by_user_id, created_at) where revision_id is null`,

  `create table workflow_lead_venues (
    id text primary key not null,
    lead_id text not null references workflow_leads(id) on delete cascade,
    trade_name text not null,
    pos_quantity integer not null,
    link_url text,
    online_url text,
    online_collection_mode text references workflow_collection_mode_kinds(value),
    address text not null,
    address_reference text not null,
    district text not null,
    province text not null,
    department text not null,
    created_at timestamptz not null,
    created_by uuid not null references members(user_id)
  )`,
  `create index idx_workflow_lead_venues_lead on workflow_lead_venues (lead_id)`,

  `create table workflow_lead_venue_accounts (
    id text primary key not null,
    venue_id text not null references workflow_lead_venues(id) on delete cascade,
    currency text not null references workflow_currency_kinds(value),
    bank text not null references workflow_settlement_banks(value),
    account_type text not null references workflow_account_type_kinds(value),
    account_number text not null,
    cci text,
    is_settlement boolean not null default 0,
    unique (venue_id, currency)
  )`,
  // A venue settles into one account.
  `create unique index idx_workflow_lead_venue_accounts_settlement_unique on workflow_lead_venue_accounts (venue_id) where is_settlement = 1`,

  `create table lead_fulfillment_orders (
    id uuid primary key not null,
    lead_id text not null unique references workflow_leads(id) on delete cascade,
    product_kind text,
    current_step text not null,
    service_b_ref text,
    created_by uuid not null references members(user_id),
    created_at timestamptz not null,
    updated_at timestamptz not null
  )`,
  `create index idx_lead_fulfillment_orders_step on lead_fulfillment_orders (current_step)`,

  `create table lead_fulfillment_units (
    id uuid primary key not null,
    order_id uuid not null references lead_fulfillment_orders(id) on delete cascade,
    venue_id text references workflow_lead_venues(id),
    label text not null,
    serial_number text,
    payment_url text,
    payment_proof_file_asset_id uuid references file_assets(id),
    payment_validated boolean not null default 0,
    service_a_ref text,
    created_at timestamptz not null
  )`,
  `create index idx_lead_fulfillment_units_order on lead_fulfillment_units (order_id)`,

  `create table lead_fulfillment_documents (
    id uuid primary key not null,
    order_id uuid not null references lead_fulfillment_orders(id) on delete cascade,
    doc_kind text not null,
    file_asset_id uuid not null unique references file_assets(id) on delete cascade,
    uploaded_by_user_id uuid not null references members(user_id),
    created_at timestamptz not null
  )`,
  `create index idx_lead_fulfillment_documents_order on lead_fulfillment_documents (order_id)`,
];
