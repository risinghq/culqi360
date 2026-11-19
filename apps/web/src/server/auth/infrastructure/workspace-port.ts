import type { Kysely } from "kysely";

import { auditEntityId } from "~/domain/audit/entity";
import type { UserId, WorkspaceId } from "~/domain/ids";
import type { Phone } from "~/domain/phone/pe-mobile";
import type {
  AuthMember,
  AuthWorkspaces,
  PhoneClaim,
} from "~/server/auth/application/ports";
import {
  createEventsWriter,
  type EventToAppend,
} from "~/server/event-logs/events-repo";
import { createUserChannelAddressRepo } from "~/server/notifications/repos/user-channel-address";
import type { WorkspaceDatabase } from "~/server/platform/database/types";
import {
  createWorkspaceSessions,
  type EndSessions,
  type OpenSession,
} from "~/server/sessions/workspace-sessions";
import { createMembersRepo } from "~/server/users/repos-members";

// What auth asks of one workspace store. The host routes AuthWorkspaces calls
// here: in process during development, through the workspace's Durable Object
// in the Worker.
export function createAuthWorkspace(
  db: Kysely<WorkspaceDatabase>,
  workspaceId: WorkspaceId,
) {
  const members = createMembersRepo(db);
  const addresses = createUserChannelAddressRepo(db);
  const sessions = createWorkspaceSessions(db, workspaceId);

  return {
    findMember(accountId: UserId): Promise<AuthMember | undefined> {
      return members.findForSession(accountId);
    },

    async findPhone(accountId: UserId): Promise<string | null> {
      const row = await addresses.findByUserAndChannel(accountId, "whatsapp");
      return row?.address ?? null;
    },

    async claimPhone(input: {
      accountId: UserId;
      phone: Phone;
      claimedAt: Date;
    }): Promise<PhoneClaim> {
      const claim = await addresses.claimWhatsAppAddress({
        userId: input.accountId,
        address: input.phone,
        claimedAt: input.claimedAt,
      });
      return { kind: claim.kind };
    },

    async completeOnboarding(input: {
      accountId: UserId;
      email: string;
      completedAt: Date;
    }): Promise<void> {
      await db.transaction().execute(async (tx) => {
        await createUserChannelAddressRepo(tx).upsert({
          user_id: input.accountId,
          channel: "email",
          address: input.email,
          is_verified: true,
          verified_at: input.completedAt,
          created_at: input.completedAt,
          updated_at: input.completedAt,
        });
        await createMembersRepo(tx).completeOnboarding(input.accountId, {
          completedAt: input.completedAt,
        });
        await createEventsWriter(tx).append({
          type: "onboarding_completed",
          entityType: "user",
          entityId: auditEntityId("user", input.accountId),
          actorUserId: input.accountId,
          occurredAt: input.completedAt,
        });
      });
    },

    openSession(input: OpenSession): Promise<void> {
      return sessions.open(input);
    },

    endSessions(input: EndSessions): Promise<void> {
      return sessions.end(input);
    },

    async recordEvent(event: EventToAppend): Promise<void> {
      await db
        .transaction()
        .execute((tx) => createEventsWriter(tx).append(event));
    },
  };
}

export type AuthWorkspace = ReturnType<typeof createAuthWorkspace>;

export function routeAuthWorkspaces(
  open: (workspaceId: WorkspaceId) => Promise<AuthWorkspace>,
): AuthWorkspaces {
  return {
    findMember: async (workspaceId, accountId) =>
      (await open(workspaceId)).findMember(accountId),
    findPhone: async (workspaceId, accountId) =>
      (await open(workspaceId)).findPhone(accountId),
    claimPhone: async (workspaceId, input) =>
      (await open(workspaceId)).claimPhone(input),
    completeOnboarding: async (workspaceId, input) =>
      (await open(workspaceId)).completeOnboarding(input),
    openSession: async (workspaceId, input) =>
      (await open(workspaceId)).openSession(input),
    endSessions: async (workspaceId, input) =>
      (await open(workspaceId)).endSessions(input),
    recordEvent: async (workspaceId, event) =>
      (await open(workspaceId)).recordEvent(event),
  };
}
