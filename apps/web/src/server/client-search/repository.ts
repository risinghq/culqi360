import { CompanyRegistryRecordId, type WorkspaceId } from "~/domain/ids";
import { insertBatches } from "~/server/platform/database/batches";
import type { RegistryExecutor } from "~/server/platform/database/executor";
import { createJobStore } from "~/server/platform/jobs/job-store";

import type {
  CompanyRegistryRepo,
  EnrichmentRequest,
  RegistryRow,
} from "./ports";

const RECORD_COLUMNS = [
  "id",
  "document_type",
  "document_value",
  "full_name",
  "legal_name",
  "address",
  "district",
  "department",
  "contributor_status",
  "contributor_condition",
  "economic_activities_json",
  "payload_json",
  "source",
  "fetched_at",
  "expires_at",
  "queue_state",
  "attempt_count",
  "max_attempts",
  "claimable_at",
  "error_message",
  "requested_by_user_id",
  "requested_at",
] as const;

// The upsert's set clause binds its three literals.
const UPSERT_SET_BINDINGS = 3;

// upsertRequests writes two tables; run it inside one registry transaction so
// the record and the workspace's subscription commit together.
export function createCompanyRegistryRepo(
  db: RegistryExecutor,
): CompanyRegistryRepo {
  const store = createJobStore<RegistryRow, string>(
    db,
    "company_registry_record",
    RECORD_COLUMNS,
  );

  return {
    store,

    async upsertRequests(values, workspaceId: WorkspaceId) {
      const [first] = values;
      if (!first) {
        return;
      }

      // A reset keeps the previous result visible while the new lookup runs.
      const rows = values.map((request: EnrichmentRequest) => ({
        id: CompanyRegistryRecordId.mint(),
        document_type: request.documentType,
        document_value: request.documentValue,
        queue_state: "pending" as const,
        claimable_at: request.requestedAt,
        attempt_count: 0,
        max_attempts: request.maxAttempts,
        error_message: null,
        requested_at: request.requestedAt,
        requested_by_user_id: request.requestedByUserId,
      }));
      const subscribedAt = first.requestedAt;
      for (const batch of insertBatches(rows, UPSERT_SET_BINDINGS)) {
        // eslint-disable-next-line no-await-in-loop
        const records = await db
          .insertInto("company_registry_record")
          .values(batch)
          .onConflict((oc) =>
            oc
              .columns(["document_type", "document_value"])
              .doUpdateSet((eb) => ({
                queue_state: "pending" as const,
                claimable_at: eb.ref("excluded.claimable_at"),
                attempt_count: 0,
                max_attempts: eb.ref("excluded.max_attempts"),
                error_message: null,
                requested_at: eb.ref("excluded.requested_at"),
                requested_by_user_id: eb.ref("excluded.requested_by_user_id"),
              })),
          )
          .returning("id")
          .execute();
        const subscriptions = records.map((record) => ({
          record_id: record.id,
          workspace_id: workspaceId,
          subscribed_at: subscribedAt,
        }));
        for (const subscribed of insertBatches(subscriptions)) {
          // eslint-disable-next-line no-await-in-loop
          await db
            .insertInto("company_registry_subscriptions")
            .values(subscribed)
            .onConflict((oc) => oc.doNothing())
            .execute();
        }
      }
    },

    async getRecord(documentType, documentValue) {
      return db
        .selectFrom("company_registry_record")
        .selectAll()
        .where("document_type", "=", documentType)
        .where("document_value", "=", documentValue)
        .executeTakeFirst();
    },

    async listSubscribers(recordId) {
      const rows = await db
        .selectFrom("company_registry_subscriptions")
        .select("workspace_id")
        .where("record_id", "=", CompanyRegistryRecordId.trust(recordId))
        .execute();
      return rows.map((row) => row.workspace_id);
    },
  };
}
