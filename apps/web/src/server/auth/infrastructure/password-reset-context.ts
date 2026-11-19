import type { Kysely } from "kysely";

import type { AuthWorkspaces } from "~/server/auth/application/ports";
import {
  type AuthIdentitiesRepo,
  createAuthIdentitiesRepo,
} from "~/server/auth/identities";
import { createPasswordResetTokensRepo } from "~/server/auth/repos-password-reset";
import { createPlatformEventsWriter } from "~/server/event-logs/platform-events-repo";
import type { MessagingGateway } from "~/server/notifications/channels/messaging-gateway";
import type { PlatformDatabase } from "~/server/platform/database/types";
import { createExecutorUow } from "~/server/platform/database/uow";

type PasswordResetReadRepos = {
  users: AuthIdentitiesRepo;
  passwordResetTokens: ReturnType<typeof createPasswordResetTokensRepo>;
};

interface PasswordResetContextDeps {
  executor: Kysely<PlatformDatabase>;
  workspaces: AuthWorkspaces;
  messaging: MessagingGateway;
}

export function createPasswordResetContext(deps: PasswordResetContextDeps) {
  const repos: PasswordResetReadRepos = {
    users: createAuthIdentitiesRepo(deps.executor, deps.workspaces),
    passwordResetTokens: createPasswordResetTokensRepo(deps.executor),
  };

  return {
    repos,
    workspaces: deps.workspaces,
    uow: createExecutorUow(deps.executor, (txDb) => ({
      users: createAuthIdentitiesRepo(txDb, deps.workspaces),
      events: createPlatformEventsWriter(txDb),
      passwordResetTokens: createPasswordResetTokensRepo(txDb),
    })),
    messaging: deps.messaging,
  };
}

type PasswordResetContext = ReturnType<typeof createPasswordResetContext>;

export type PasswordResetRequestContext = Pick<
  PasswordResetContext,
  "repos" | "messaging" | "uow" | "workspaces"
>;
