import type { WorkspaceId } from "~/domain/ids";
import { routeAuthWorkspaces } from "~/server/auth/infrastructure/workspace-port";
import { createAuthRuntime } from "~/server/auth/runtime";
import { platformCleanupDuty } from "~/server/auth/session/cleanup";
import { createWhatsAppRouter } from "~/server/integrations/kapso/webhooks/route-delivery";
import { createInvitePlatform } from "~/server/invites/infrastructure/invite-platform";
import { createInviteAcceptance } from "~/server/invites/infrastructure/invite-service-factory";
import type { MessagingGateway } from "~/server/notifications/channels/messaging-gateway";
import type { NotificationsConfig } from "~/server/platform/config/env";
import type { BlobStore } from "~/server/platform/files/blob-store";
import type { PlatformInfrastructure } from "~/server/platform/infrastructure";
import type { Duty } from "~/server/platform/schedule/schedule";
import { createAccountAvatars } from "~/server/users/account-avatars";
import { createMemberAccounts } from "~/server/users/infrastructure/member-accounts";

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
    webhooks: {
      receiveWhatsApp: createWhatsAppRouter(db, host.workspace),
      async verifyWhatsAppSubscription(input: {
        mode: string | null;
        token: string | null;
      }): Promise<boolean> {
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

// What a request reaches of the platform, from its own store or from another
// one. The duties run only where the platform store lives.
export type PlatformSurface = Omit<PlatformApplication, "createDuties">;
