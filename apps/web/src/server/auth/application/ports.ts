import type { UserId, WorkspaceId } from "~/domain/ids";
import type { Phone } from "~/domain/phone/pe-mobile";
import type { MemberPlacement } from "~/server/auth/application/queries/list-all-active-sessions";
import type { AuthIdentitiesRepo } from "~/server/auth/identities";
import type { EventToAppend } from "~/server/event-logs/events-repo";
import type { PlatformEventsWriter } from "~/server/event-logs/platform-events-repo";
import type { AppUow } from "~/server/platform/database/uow";
import type { SessionRepository } from "~/server/sessions/repos-sessions";
import type { SessionMember } from "~/server/users/repos-members";

export type AuthMember = SessionMember;

export type PhoneClaim = { kind: "claimed" } | { kind: "already_claimed" };

// Auth runs on the platform store; a member, its phone and its extension
// sessions live in a workspace store. Each call is its own write there, so a
// flow calls it outside its platform transaction.
export interface AuthWorkspaces {
  findMember(
    workspaceId: WorkspaceId,
    accountId: UserId,
  ): Promise<AuthMember | undefined>;
  findPhone(
    workspaceId: WorkspaceId,
    accountId: UserId,
  ): Promise<string | null>;
  claimPhone(
    workspaceId: WorkspaceId,
    input: { accountId: UserId; phone: Phone; claimedAt: Date },
  ): Promise<PhoneClaim>;
  completeOnboarding(
    workspaceId: WorkspaceId,
    input: { accountId: UserId; email: string; completedAt: Date },
  ): Promise<void>;
  findPlacements(
    workspaceId: WorkspaceId,
    accountIds: readonly UserId[],
  ): Promise<ReadonlyMap<UserId, MemberPlacement>>;
  // Without an auth session id, every extension session of the account ends.
  endExtensionAccess(
    workspaceId: WorkspaceId,
    input: { accountId: UserId; authSessionId?: string; endedAt: Date },
  ): Promise<void>;
  // Appends to the workspace's audit log, where its admins read it and its
  // notification policies act on it.
  recordEvent(workspaceId: WorkspaceId, event: EventToAppend): Promise<void>;
}

export type AccessSecurityTx = {
  users: AuthIdentitiesRepo;
  sessions: SessionRepository;
  events: PlatformEventsWriter;
};

export type AccessSecurityDeps = {
  uow: AppUow<AccessSecurityTx>;
  workspaces: AuthWorkspaces;
};
