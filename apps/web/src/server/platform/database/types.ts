import type { ColumnType } from "kysely";

import type { GeneratedId, WorkspaceId } from "~/domain/ids";

import * as auth from "./schema/modules/auth.types";
import * as calls from "./schema/modules/calls.types";
import * as campaigns from "./schema/modules/campaigns.types";
import * as capacity from "./schema/modules/capacity.types";
import * as cases from "./schema/modules/cases.types";
import * as contactAssignments from "./schema/modules/contact-assignments.types";
import * as core from "./schema/modules/core.types";
import * as extensions from "./schema/modules/extensions.types";
import * as files from "./schema/modules/files.types";
import * as fulfillment from "./schema/modules/fulfillment.types";
import * as identity from "./schema/modules/identity.types";
import * as integrations from "./schema/modules/integrations.types";
import * as merchantStats from "./schema/modules/merchant-stats.types";
import * as notifications from "./schema/modules/notifications.types";
import * as observability from "./schema/modules/observability.types";
import * as organization from "./schema/modules/organization.types";
import * as platform from "./schema/modules/platform.types";
import * as pricing from "./schema/modules/pricing.types";
import * as sales from "./schema/modules/sales.types";
import * as search from "./schema/modules/search.types";
import type {
  GlobalTable,
  WorkspaceTaggedTable,
} from "./schema/modules/tenancy";
import * as workflow from "./schema/modules/workflow.types";

export * from "./schema/modules/auth.types";
export * from "./schema/modules/calls.types";
export * from "./schema/modules/campaigns.types";
export * from "./schema/modules/capacity.types";
export * from "./schema/modules/cases.types";
export * from "./schema/modules/contact-assignments.types";
export * from "./schema/modules/core.types";
export * from "./schema/modules/identity.types";
export * from "./schema/modules/organization.types";
export * from "./schema/modules/extensions.types";
export * from "./schema/modules/files.types";
export * from "./schema/modules/fulfillment.types";
export * from "./schema/modules/integrations.types";
export * from "./schema/modules/merchant-stats.types";
export * from "./schema/modules/notifications.types";
export * from "./schema/modules/observability.types";
export * from "./schema/modules/platform.types";
export * from "./schema/modules/pricing.types";
export * from "./schema/modules/sales.types";
export * from "./schema/modules/search.types";
export * from "./schema/modules/workflow.types";

type WorkspaceOwnedColumn = GeneratedId<WorkspaceId>;
type WorkspaceTaggedColumn = ColumnType<
  WorkspaceId | null,
  WorkspaceId | string | null | undefined,
  WorkspaceId | string | null
>;

type DatabaseView =
  | "organization_current_owners"
  | "merchant_sales"
  | "merchant_sale_gpv"
  | "merchant_monthly_gpv"
  | "merchant_month_credit";

// Adds the workspace_id column that schema/workspace-column.ts puts on every
// table outside GLOBAL_TABLES, so the module table types stay unchanged.
export type Database = {
  [K in keyof DatabaseTables]: K extends GlobalTable | DatabaseView
    ? DatabaseTables[K]
    : K extends WorkspaceTaggedTable
      ? DatabaseTables[K] & { workspace_id: WorkspaceTaggedColumn }
      : DatabaseTables[K] & { workspace_id: WorkspaceOwnedColumn };
};

interface DatabaseTables {
  workspaces: core.WorkspacesTable;
  branches: core.BranchesTable;
  teams: core.TeamsTable;
  branch_supervisors: core.BranchSupervisorsTable;
  back_office_teams: core.BackOfficeTeamsTable;
  organizations: organization.OrganizationsTable;
  organization_ownerships: organization.OrganizationOwnershipsTable;
  organization_current_owners: organization.OrganizationCurrentOwnersView;
  people: organization.PeopleTable;
  contacts: organization.ContactsTable;
  contact_roles: organization.ContactRolesTable;
  login_flows: auth.LoginFlowsTable;
  passkeys: auth.PasskeysTable;
  webauthn_challenges: auth.WebauthnChallengesTable;
  user_oauth_accounts: auth.UserOAuthAccountsTable;
  password_reset_tokens: auth.PasswordResetTokensTable;
  user_sessions: auth.UserSessionsTable;
  request_sessions: auth.RequestSessionsTable;
  user_totp_factors: auth.UserTotpFactorsTable;
  recovery_code_set: auth.RecoveryCodeSetTable;
  recovery_code: auth.RecoveryCodeTable;
  user_invites: auth.UserInvitesTable;
  auth_funnel_events: auth.AuthFunnelEventsTable;
  workspace_roles: identity.WorkspaceRolesTable;
  workspace_role_assignables: identity.WorkspaceRoleAssignablesTable;
  users: identity.UsersTable;
  contact_assignments: contactAssignments.ContactAssignmentsTable;
  contact_cadence: contactAssignments.ContactCadenceTable;
  capacity_grants: capacity.CapacityGrantsTable;
  capacity_reservations: capacity.CapacityReservationsTable;
  capacity_commits: capacity.CapacityCommitsTable;
  capacity_requests: capacity.CapacityRequestsTable;
  draw_policy_defaults: capacity.DrawPolicyDefaultsTable;
  draw_policy_overrides: capacity.DrawPolicyOverridesTable;
  search_policy_defaults: capacity.SearchPolicyDefaultsTable;
  search_policy_overrides: capacity.SearchPolicyOverridesTable;
  user_channel_addresses: notifications.UserChannelAddressesTable;
  notification_opt_outs: notifications.NotificationOptOutsTable;
  notification_deliveries: notifications.NotificationDeliveriesTable;
  app_notifications: notifications.AppNotificationsTable;
  notification_intents: notifications.NotificationIntentsTable;
  whatsapp_sessions: notifications.WhatsAppSessionsTable;
  kapso_webhook_deliveries: notifications.KapsoWebhookDeliveriesTable;
  whatsapp_inbound_events: notifications.WhatsAppInboundEventsTable;
  outbound_whatsapp_messages: notifications.OutboundWhatsAppMessagesTable;
  extension_handoffs: extensions.ExtensionHandoffsTable;
  extension_installation_sessions: extensions.ExtensionInstallationSessionsTable;
  extension_runtime_events: extensions.ExtensionRuntimeEventsTable;
  extension_executive_statuses: extensions.ExtensionExecutiveStatusesTable;
  extension_recordings: extensions.ExtensionRecordingsTable;
  extension_recording_segments: extensions.ExtensionRecordingSegmentsTable;
  company_registry_record: search.CompanyRegistryRecordTable;
  events: platform.EventsTable;
  audit_action_policies: platform.AuditActionPoliciesTable;
  action_observations: observability.ActionObservationsTable;
  agent_status_logs: observability.AgentStatusLogsTable;
  action_rate_limit_counters: observability.ActionRateLimitCountersTable;
  auth_throttle_counters: observability.AuthThrottleCountersTable;
  auth_events: observability.AuthEventsTable;
  workflow_leads: workflow.WorkflowLeadsTable;
  workflow_inquiries: workflow.WorkflowInquiriesTable;
  workflow_collection_mode_kinds: workflow.WorkflowCollectionModeKindsTable;
  workflow_lead_digital_policy: workflow.WorkflowLeadDigitalPolicyTable;
  workflow_rate_proposals: pricing.WorkflowRateProposalsTable;
  workflow_rate_proposal_policies: pricing.WorkflowRateProposalPoliciesTable;
  workflow_pending_quotation_policies: pricing.WorkflowPendingQuotationPoliciesTable;
  workflow_rate_revisions: pricing.WorkflowRateRevisionsTable;
  workflow_rate_revision_files: pricing.WorkflowRateRevisionFilesTable;
  workflow_lead_favorites: workflow.WorkflowLeadFavoritesTable;
  campaigns: campaigns.CampaignsTable;
  campaign_records: campaigns.CampaignRecordsTable;
  campaign_holds: campaigns.CampaignHoldsTable;
  case_types: cases.CaseTypesTable;
  case_stages: cases.CaseStagesTable;
  case_fields: cases.CaseFieldsTable;
  cases: cases.CasesTable;
  case_stage_states: cases.CaseStageStatesTable;
  calls: calls.CallsTable;
  workflow_integration_jobs: integrations.WorkflowIntegrationJobsTable;
  workflow_integration_import_rows: integrations.WorkflowIntegrationImportRowsTable;
  gpv_snapshots: merchantStats.GpvSnapshotsTable;
  gpv_snapshot_jobs: merchantStats.GpvSnapshotJobsTable;
  merchant_gpv_dataset: merchantStats.MerchantGpvDatasetTable;
  gpv_snapshot_placements: merchantStats.GpvSnapshotPlacementsTable;
  gpv_snapshot_observations: merchantStats.GpvSnapshotObservationsTable;
  gpv_snapshot_issues: merchantStats.GpvSnapshotIssuesTable;
  merchant_month_credits: merchantStats.MerchantMonthCreditsTable;
  merchant_month_credit_adjustments: merchantStats.MerchantMonthCreditAdjustmentsTable;
  merchant_gpv_targets: merchantStats.MerchantGpvTargetsTable;
  commission_scheme_versions: merchantStats.CommissionSchemeVersionsTable;
  merchant_sales: merchantStats.MerchantSalesView;
  merchant_sale_gpv: merchantStats.MerchantSaleGpvView;
  merchant_monthly_gpv: merchantStats.MerchantMonthlyGpvView;
  merchant_month_credit: merchantStats.MerchantMonthCreditView;
  file_assets: files.FileAssetsTable;
  file_download_tokens: files.FileDownloadTokensTable;
  workflow_sale_proof_files: files.WorkflowSaleProofFilesTable;
  lead_fulfillment_orders: fulfillment.LeadFulfillmentOrdersTable;
  lead_fulfillment_units: fulfillment.LeadFulfillmentUnitsTable;
  lead_fulfillment_documents: fulfillment.LeadFulfillmentDocumentsTable;
  workflow_lead_venues: sales.WorkflowLeadVenuesTable;
  workflow_lead_venue_accounts: sales.WorkflowLeadVenueAccountsTable;
  workflow_currency_kinds: sales.WorkflowCurrencyKindsTable;
  workflow_account_type_kinds: sales.WorkflowAccountTypeKindsTable;
  workflow_settlement_banks: sales.WorkflowSettlementBanksTable;
}
