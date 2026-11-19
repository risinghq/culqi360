import type { Kysely } from "kysely";

import type {
  AccessSecurityDeps,
  AccessSecurityTx,
  AuthWorkspaces,
} from "~/server/auth/application/ports";
import { createAuthIdentitiesRepo } from "~/server/auth/identities";
import { createPlatformEventsWriter } from "~/server/event-logs/platform-events-repo";
import type { PlatformExecutor } from "~/server/platform/database/executor";
import type { PlatformDatabase } from "~/server/platform/database/types";
import { createExecutorUow } from "~/server/platform/database/uow";
import { createSessionRepository } from "~/server/sessions/repos-sessions";

export function createAccessSecurityTx(
  tx: PlatformExecutor,
  workspaces: AuthWorkspaces,
): AccessSecurityTx {
  return {
    users: createAuthIdentitiesRepo(tx, workspaces),
    sessions: createSessionRepository(tx),
    events: createPlatformEventsWriter(tx),
  };
}

export function createAccessSecurityContext(
  db: Kysely<PlatformDatabase>,
  workspaces: AuthWorkspaces,
): AccessSecurityDeps {
  return {
    uow: createExecutorUow(db, (tx) => createAccessSecurityTx(tx, workspaces)),
    workspaces,
  };
}
