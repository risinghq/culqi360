import type { Kysely } from "kysely";

import type { WorkspaceId } from "~/domain/ids";
import {
  createAuthWorkspace,
  routeAuthWorkspaces,
} from "~/server/auth/infrastructure/workspace-port";
import { createAuthRuntime } from "~/server/auth/runtime";
import { runPlatformCleanupTick } from "~/server/auth/session/cleanup";
import { extensionCredentialAuthSessionId } from "~/server/extension/crypto";
import { kapsoEnvelopePhoneNumberId } from "~/server/integrations/kapso/webhooks/kapso-envelope";
import { createInvitePlatform } from "~/server/invites/infrastructure/invite-platform";
import {
  createInviteAcceptance,
  inProcessMemberPlacement,
} from "~/server/invites/infrastructure/invite-service-factory";
import type { MessagingGateway } from "~/server/notifications/channels/messaging-gateway";
import type { NotificationsConfig } from "~/server/platform/config/env";
import type {
  PlatformDatabase,
  WorkspaceDatabase,
} from "~/server/platform/database/types";
import type { BlobStore } from "~/server/platform/files/blob-store";
import type { PlatformInfrastructure } from "~/server/platform/infrastructure";
import type { OperationContext } from "~/server/platform/operation/context";
import { createRequestSessionsRepo } from "~/server/security/repos-request-sessions";
import { createAccountAvatars } from "~/server/users/account-avatars";
import { createMembersRepo } from "~/server/users/repos-members";
import { Ok, type Result } from "~/shared/result";

// What the platform app needs from the host it runs in.
export interface PlatformHostServices {
  workspaceDb: (workspaceId: WorkspaceId) => Promise<Kysely<WorkspaceDatabase>>;
  messaging: MessagingGateway;
  avatarStore: BlobStore;
  notifications: NotificationsConfig;
}

// The platform store's application: sign-in, sessions, accounts, invites, and
// the routing that sends an anonymous request to its workspace.
export function createPlatformApplication(
  platform: PlatformInfrastructure,
  host: PlatformHostServices,
) {
  const { db } = platform;

  const invites = createInviteAcceptance({
    db,
    workspaces: inProcessMemberPlacement({
      workspaceDb: host.workspaceDb,
      platform: createInvitePlatform(db),
    }),
  });
  const auth = createAuthRuntime(platform, {
    workspaces: routeAuthWorkspaces(async (workspaceId) =>
      createAuthWorkspace(await host.workspaceDb(workspaceId)),
    ),
    invites,
    messaging: host.messaging,
  });
  const avatars = createAccountAvatars(
    db,
    host.avatarStore,
    async (workspaceId, accountId, values) =>
      createMembersRepo(await host.workspaceDb(workspaceId)).updateIdentity(
        accountId,
        values,
      ),
  );

  return {
    auth,
    avatars,
    invites: { findInviteInfo: invites.findInviteInfo },
    http: {
      requestContext: {
        resolveAuthSession: auth.sessions.resolve,
        requestSessions: createRequestSessionsRepo(db),
      },
    },
    routing: createWorkspaceRouting(db),
    webhooks: {
      verifyWhatsAppSubscription(input: {
        mode: string | null;
        token: string | null;
      }): boolean {
        return (
          input.mode === "subscribe" &&
          input.token === host.notifications.whatsappWebhookVerifyToken
        );
      },
    },
    cleanup: (context: OperationContext) => runPlatformCleanupTick(db, context),
  };
}

export type PlatformApplication = ReturnType<typeof createPlatformApplication>;

// Requests that carry no session cookie name their workspace another way: an
// extension credential names its auth session, and a WhatsApp delivery names
// the number it was sent to.
function createWorkspaceRouting(db: Kysely<PlatformDatabase>) {
  async function authSessionWorkspace(
    authSessionId: string,
  ): Promise<WorkspaceId | null> {
    const row = await db
      .selectFrom("user_sessions")
      .select("workspace_id")
      .where("id", "=", authSessionId)
      .executeTakeFirst();
    return row?.workspace_id ?? null;
  }

  return {
    async extensionWorkspace(credential: string): Promise<WorkspaceId | null> {
      const authSessionId = extensionCredentialAuthSessionId(credential);
      return authSessionId ? authSessionWorkspace(authSessionId) : null;
    },

    async whatsAppWorkspace(
      rawBody: string,
    ): Promise<Result<WorkspaceId | null, string>> {
      const phoneNumberId = kapsoEnvelopePhoneNumberId(rawBody);
      if (!phoneNumberId.ok) {
        return phoneNumberId;
      }
      if (phoneNumberId.value === null) {
        return Ok(null);
      }
      const row = await db
        .selectFrom("whatsapp_numbers")
        .select("workspace_id")
        .where("phone_number_id", "=", phoneNumberId.value)
        .executeTakeFirst();
      return Ok(row?.workspace_id ?? null);
    },
  };
}
