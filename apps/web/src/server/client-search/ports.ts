import type { Selectable } from "kysely";

import type { Document, DocumentKind } from "~/domain/identity/document";
import type { WorkspaceId } from "~/domain/ids";
import type { CompanyRegistryRecordTable } from "~/server/platform/database/schema/types/search";
import type { JobStore } from "~/server/platform/jobs/job-store";
import type { OperationContext } from "~/server/platform/operation/context";

import type { EnrichmentStatus } from "./model";

export type RegistryRow = Selectable<CompanyRegistryRecordTable>;

export type EnrichmentRequest = {
  documentType: DocumentKind;
  documentValue: string;
  requestedByUserId: string | null;
  requestedAt: Date;
  maxAttempts: number;
};

// The organization fields a settled scrape (or engine fallback) carries into
// each subscribing workspace.
export type OrganizationProjection = {
  ruc: string;
  legalName: string | null;
  address: string | null;
  district: string | null;
  department: string | null;
};

export interface CompanyRegistryRepo {
  // The worker drives the store through the queue engine; result columns are
  // written as the engine settles the row.
  store: JobStore<string, RegistryRow>;
  // Insert or reset each record to `pending` and subscribe the workspace.
  upsertRequests(
    values: EnrichmentRequest[],
    workspaceId: WorkspaceId,
  ): Promise<void>;
  getRecord(
    documentType: DocumentKind,
    documentValue: string,
  ): Promise<RegistryRow | null | undefined>;
  listSubscribers(recordId: string): Promise<WorkspaceId[]>;
}

// What a workspace sees of the registry. The registry is another store, so a
// workspace never calls this inside its own transaction.
export interface CompanyRegistryClient {
  request(input: {
    workspaceId: WorkspaceId;
    documents: readonly Document[];
    requestedByUserId: string | null;
    operation: OperationContext;
  }): Promise<void>;
  getStatus: (document: Document, freshAsOf: Date) => Promise<EnrichmentStatus>;
}

// How the registry reaches each subscribing workspace once a record settles.
export interface RegistryWorkspaceSink {
  project(
    workspaceId: WorkspaceId,
    projection: OrganizationProjection,
  ): Promise<void>;
  publish(workspaceId: WorkspaceId, status: EnrichmentStatus): Promise<void>;
}
