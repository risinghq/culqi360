import type { Generated } from "kysely";

import type { Json } from "~/contracts/json";
import type {
  BranchId,
  CallId,
  CampaignRecordId,
  CaseId,
  ContactId,
  ExtensionRecordingId,
  GeneratedId,
  IdColumn,
  InstallationId,
  NullableIdColumn,
  OrganizationId,
  UserId,
} from "~/domain/ids";

export interface ExtensionHandoffsTable {
  jti: string;
  user_id: IdColumn<UserId>;
  branch_id: IdColumn<BranchId>;
  auth_session_id: string;
  organization_id: IdColumn<OrganizationId>;
  campaign_record_id: NullableIdColumn<CampaignRecordId>;
  case_id: NullableIdColumn<CaseId>;
  contact_id: NullableIdColumn<ContactId>;
  phone: string;
  call_id: NullableIdColumn<CallId>;
  origin: string;
  installation_id: NullableIdColumn<InstallationId>;
  installation_session_jti: string | null;
  issued_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
}

export interface ExtensionInstallationSessionsTable {
  jti: string;
  user_id: IdColumn<UserId>;
  branch_id: IdColumn<BranchId>;
  auth_session_id: string;
  installation_id: IdColumn<InstallationId>;
  refresh_token_hash: string;
  issued_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  last_seen_at: Date | null;
  refreshed_at: Date | null;
}

export interface ExtensionRuntimeEventsTable {
  id: string;
  sequence: number;
  user_id: IdColumn<UserId>;
  branch_id: IdColumn<BranchId>;
  call_session_id: string | null;
  type:
    | "executive.presence"
    | "executive.heartbeat"
    | "call.lifecycle"
    | "call.metric"
    | "recording.completed"
    | "recording.chunk";
  payload_json: Json;
  created_at: Date;
  received_at: Date;
}

export interface ExtensionExecutiveStatusesTable {
  user_id: IdColumn<UserId>;
  branch_id: IdColumn<BranchId>;
  call_session_id: string | null;
  presence_status:
    | "idle"
    | "ready"
    | "dialing"
    | "active"
    | "wrap_up"
    | "offline"
    | null;
  presence_updated_at: Date | null;
  sync_health: "ok" | "stale" | "reauth_required";
  sync_updated_at: Date | null;
  source_event_id: string | null;
  source_event_sequence: number | null;
}

export type ExtensionRecordingStatus = "open" | "interrupted" | "complete";

export interface ExtensionRecordingsTable {
  id: GeneratedId<ExtensionRecordingId>;
  call_id: IdColumn<CallId>;
  created_at: Date;
  last_activity_at: Date;
  status: Generated<ExtensionRecordingStatus>;
  closed_at: Date | null;
  reported_interrupted: Generated<boolean>;
  expected_segments: number | null;
  expected_bytes: number | null;
}

export interface ExtensionRecordingSegmentsTable {
  recording_id: IdColumn<ExtensionRecordingId>;
  seq: number;
  storage_key: string;
  content_type: string;
  channels: string;
  started_at: Date;
  size_bytes: number;
  sha256_hex: string;
  received_at: Date;
}
