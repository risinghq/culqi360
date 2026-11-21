// How each of the old culqi360 deploy's tables lands in work360. The culqi
// module kept the old schema, so most tables copy column for column.

export type TableCopy = {
  source: string;
  target: string;
  // Source column to target column, for a column work360 renamed.
  rename?: Readonly<Record<string, string>>;
  // Source columns work360 no longer has.
  drop?: readonly string[];
  // Target columns set to null, because the rows they point at stay behind.
  clear?: readonly string[];
  // `merge` keeps a row the seeded workspace already holds; `replace`
  // overwrites it. Without one, a clash fails the run.
  onConflict?: "merge" | "replace";
};

const CONTACT = { organization_person_id: "contact_id" };

// In foreign key order. The members come first, from `users` (derived.ts).
export const WORKSPACE_TABLES: readonly TableCopy[] = [
  { source: "branches", target: "branches" },
  { source: "teams", target: "teams" },
  { source: "branch_supervisors", target: "branch_supervisors" },
  { source: "back_office_assignments", target: "back_office_teams" },
  { source: "people", target: "people" },
  { source: "organizations", target: "organizations" },
  { source: "organization_people", target: "contacts" },
  {
    source: "organization_person_roles",
    target: "contact_roles",
    rename: CONTACT,
  },
  { source: "contact_cadence", target: "contact_cadence", rename: CONTACT },
  {
    source: "organization_owner_assignments",
    target: "organization_ownerships",
  },
  {
    source: "workflow_currency_kinds",
    target: "workflow_currency_kinds",
    onConflict: "merge",
  },
  {
    source: "workflow_collection_mode_kinds",
    target: "workflow_collection_mode_kinds",
    onConflict: "merge",
  },
  {
    source: "workflow_account_type_kinds",
    target: "workflow_account_type_kinds",
    onConflict: "merge",
  },
  {
    source: "workflow_settlement_banks",
    target: "workflow_settlement_banks",
    onConflict: "merge",
  },
  {
    source: "audit_action_policies",
    target: "audit_action_policies",
    onConflict: "merge",
  },
  { source: "search_policy_defaults", target: "search_policy_defaults" },
  { source: "lead_policy_defaults", target: "draw_policy_defaults" },
  { source: "workflow_leads", target: "workflow_leads" },
  {
    source: "workflow_lead_digital_policy",
    target: "workflow_lead_digital_policy",
  },
  { source: "workflow_lead_favorites", target: "workflow_lead_favorites" },
  { source: "workflow_lead_venues", target: "workflow_lead_venues" },
  {
    source: "workflow_lead_venue_accounts",
    target: "workflow_lead_venue_accounts",
  },
  { source: "workflow_rate_proposals", target: "workflow_rate_proposals" },
  {
    source: "workflow_rate_proposal_policies",
    target: "workflow_rate_proposal_policies",
  },
  { source: "workflow_rate_revisions", target: "workflow_rate_revisions" },
  {
    source: "workflow_inquiries",
    target: "workflow_inquiries",
    drop: ["answered_by_job_id"],
  },
  { source: "lead_fulfillment_orders", target: "lead_fulfillment_orders" },
  {
    source: "lead_fulfillment_units",
    target: "lead_fulfillment_units",
    clear: ["payment_proof_file_asset_id"],
  },
  {
    source: "merchant_gpv_dataset",
    target: "merchant_gpv_dataset",
    onConflict: "replace",
  },
  { source: "merchant_month_credits", target: "merchant_month_credits" },
  // gpv_snapshots comes from derived.ts's file join, before its placements.
  {
    source: "gpv_snapshot_placements",
    target: "gpv_snapshot_placements",
    rename: {
      sold_at: "sold_on",
      trial_at: "trial_on",
      activated_at: "activated_on",
      last_transaction_at: "last_transaction_on",
    },
  },
  {
    source: "gpv_snapshot_observations",
    target: "gpv_snapshot_observations",
    drop: ["realized_month"],
  },
  { source: "gpv_snapshot_issues", target: "gpv_snapshot_issues" },
  { source: "events", target: "events" },
  { source: "app_notifications", target: "app_notifications" },
];

export const REGISTRY_TABLES: readonly TableCopy[] = [
  {
    source: "company_registry_record",
    target: "company_registry_record",
    drop: ["lease_owner"],
  },
];

// Not copied, and why. The report counts their rows.
export const LEFT_BEHIND: Readonly<Record<string, string>> = {
  // Sessions and credentials: every user sets a new password.
  user_sessions: "credential",
  request_sessions: "credential",
  login_flows: "credential",
  password_reset_tokens: "credential",
  recovery_code: "credential",
  recovery_code_set: "credential",
  user_totp_factors: "credential",
  user_invites: "credential",
  auth_events: "credential",
  auth_funnel_events: "credential",
  auth_throttle_counters: "credential",
  // A pending intent or a user's phone would let work360 message a real person.
  notification_intents: "outbound",
  notification_deliveries: "outbound",
  user_channel_addresses: "outbound",
  // Customers' documents. Their blobs stay on the old deploy.
  file_assets: "file",
  file_download_tokens: "file",
  workflow_rate_revision_files: "file",
  lead_fulfillment_documents: "file",
  // Job queues and counters of the old deploy.
  action_observations: "job",
  workflow_integration_jobs: "job",
  workflow_integration_import_rows: "job",
  gpv_snapshot_jobs: "job",
  search_usage_commits: "job",
  search_usage_reservations: "job",
  schema_integrity: "job",
};
