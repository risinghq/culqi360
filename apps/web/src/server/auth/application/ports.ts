import type { UserId, WorkspaceId } from "~/domain/ids";
import type { Phone } from "~/domain/phone/pe-mobile";
import type { EventToAppend } from "~/server/event-logs/events-repo";
import type {
  EndSessions,
  OpenSession,
} from "~/server/sessions/workspace-sessions";
import type { SessionMember } from "~/server/users/repos-members";

export type AuthMember = SessionMember;

export type PhoneClaim = { kind: "claimed" } | { kind: "already_claimed" };

// Auth runs on the platform store; a member, its phone and its sessions live
// in a workspace store. Each call is its own write there, so a flow calls it
// outside its platform transaction.
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
  openSession(workspaceId: WorkspaceId, input: OpenSession): Promise<void>;
  // Ends the sessions and the extension access bound to them.
  endSessions(workspaceId: WorkspaceId, input: EndSessions): Promise<void>;
  // Appends to the workspace's audit log, where its admins read it and its
  // notification policies act on it.
  recordEvent(workspaceId: WorkspaceId, event: EventToAppend): Promise<void>;
}
