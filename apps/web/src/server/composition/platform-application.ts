import type { Kysely } from "kysely";

import type { WorkspaceId } from "~/domain/ids";
import { routeAuthWorkspaces } from "~/server/auth/infrastructure/workspace-port";
import { createAuthRuntime } from "~/server/auth/runtime";
import { platformCleanupDuty } from "~/server/auth/session/cleanup";
import { extensionCredentialWorkspace } from "~/server/extension/crypto";
import { kapsoEnvelopePhoneNumberId } from "~/server/integrations/kapso/webhooks/kapso-envelope";
import { createInvitePlatform } from "~/server/invites/infrastructure/invite-platform";
import { createInviteAcceptance } from "~/server/invites/infrastructure/invite-service-factory";
import type { MessagingGateway } from "~/server/notifications/channels/messaging-gateway";
import type { NotificationsConfig } from "~/server/platform/config/env";
import type { PlatformDatabase } from "~/server/platform/database/types";
import type { BlobStore } from "~/server/platform/files/blob-store";
import type { PlatformInfrastructure } from "~/server/platform/infrastructure";
import type { Duty } from "~/server/platform/schedule/schedule";
import { createAccountAvatars } from "~/server/users/account-avatars";
import { createMemberAccounts } from "~/server/users/infrastructure/member-accounts";
import { Ok, type Result } from "~/shared/result";

import type {
  PlatformPorts,
  WorkspaceApplication,
} from "./workspace-application";

// What the platform asks of one workspace store: that workspace application's
// `inbound`.
export type WorkspacePorts = WorkspaceApplication["inbound"];

// What the platform app needs from the host it runs in.
export interface PlatformHostServices {
  workspace: (workspaceId: WorkspaceId) => Promise<WorkspacePorts>;
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
    workspaces: {
      placeMember: async (workspaceId, member, placedAt) =>
        (await host.workspace(workspaceId)).placeMember(member, placedAt),
    },
  });
  const auth = createAuthRuntime(platform, {
    workspaces: routeAuthWorkspaces(
      async (workspaceId) => (await host.workspace(workspaceId)).auth,
    ),
    invites,
    messaging: host.messaging,
  });
  const avatars = createAccountAvatars(
    db,
    host.avatarStore,
    async (workspaceId, accountId, values) =>
      (await host.workspace(workspaceId)).updateMemberIdentity(
        accountId,
        values,
      ),
  );

  // What a workspace store may ask of the platform.
  const inbound: PlatformPorts = {
    accounts: createMemberAccounts(db),
    invites: createInvitePlatform(db),
    avatars,
  };

  return {
    inbound,
    auth,
    avatars,
    invites: { findInviteInfo: invites.findInviteInfo },
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
    createDuties: (): Duty[] => [platformCleanupDuty(db)],
  };
}

export type PlatformApplication = ReturnType<typeof createPlatformApplication>;

// Requests that carry no session cookie name their workspace another way: an
// extension credential carries it, and a WhatsApp delivery names the number it
// was sent to.
function createWorkspaceRouting(db: Kysely<PlatformDatabase>) {
  return {
    extensionWorkspace: extensionCredentialWorkspace,

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
