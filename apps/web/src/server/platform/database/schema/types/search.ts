import type { ColumnType } from "kysely";

import type {
  CompanyRegistryRecordId,
  IdColumn,
  UserId,
  WorkspaceId,
} from "~/domain/ids";
import type { SunatEconomicActivity } from "~/server/client-search/enrichment/sunat/contracts";

// Registry store: public SUNAT records shared by every workspace.
export interface CompanyRegistryRecordTable {
  id: IdColumn<CompanyRegistryRecordId>;
  document_type: "dni" | "ruc";
  document_value: string;
  full_name: string | null;
  legal_name: string | null;
  address: string | null;
  district: string | null;
  department: string | null;
  contributor_status: string | null;
  contributor_condition: string | null;
  economic_activities_json: ColumnType<
    SunatEconomicActivity[] | null,
    string | null,
    string | null
  >;
  payload_json: ColumnType<unknown, string | null, string | null>;
  source: "sunat" | "engine" | null;
  fetched_at: Date | null;
  expires_at: Date | null;
  queue_state: "pending" | "processing" | "done" | "failed";
  attempt_count: ColumnType<number, number | undefined, number>;
  max_attempts: ColumnType<number, number | undefined, number>;
  claimable_at: Date;
  completed_at: Date | null;
  error_message: string | null;
  requested_by_user_id: IdColumn<UserId> | null;
  requested_at: Date;
}

export interface CompanyRegistrySubscriptionsTable {
  record_id: IdColumn<CompanyRegistryRecordId>;
  workspace_id: IdColumn<WorkspaceId>;
  subscribed_at: Date;
}
