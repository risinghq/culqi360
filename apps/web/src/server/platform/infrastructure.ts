import type { Kysely } from "kysely";

import type { WorkspaceId } from "~/domain/ids";
import type { CommitEffects } from "~/server/platform/database/commit-effects";
import type {
  PlatformDatabase,
  WorkspaceDatabase,
} from "~/server/platform/database/types";
import type { BlobStore } from "~/server/platform/files/blob-store";
import type { Logger } from "~/shared/observability/logger";

// Resources only. Time is not a resource: it enters at the request, action,
// queue and worker edges and travels inward as a Date, so nothing composed
// here needs a clock handed to it.

export type InfrastructureLogger = Pick<Logger, "info" | "error">;

export interface PlatformInfrastructure {
  db: Kysely<PlatformDatabase>;
  logger: InfrastructureLogger;
}

// One workspace's store. Its tables carry no workspace column, so the id
// travels here for the platform ports that key their rows by workspace.
export interface WorkspaceInfrastructure {
  workspaceId: WorkspaceId;
  db: Kysely<WorkspaceDatabase>;
  effects: CommitEffects;
  // The workspace's own files.
  blobs: BlobStore;
  logger: InfrastructureLogger;
}
