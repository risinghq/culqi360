import { auditEntityId } from "~/domain/audit/entity";
import type { UserId } from "~/domain/ids";
import type { AuthWorkspaces } from "~/server/auth/application/ports";
import type { AuthIdentitiesRepo } from "~/server/auth/identities";
import type { EventToAppend } from "~/server/event-logs/events-repo";

// An account's sessions and its audit trail live in each of its workspaces,
// so a change to its credentials is one call per workspace. Run these after
// the platform commit that made the change: a failure here leaves the change
// in place and the error with the caller, who can retry.
interface AccountWorkspaceDeps<K extends keyof AuthWorkspaces> {
  users: Pick<AuthIdentitiesRepo, "listWorkspaceIds">;
  workspaces: Pick<AuthWorkspaces, K>;
}

// Ends every session of the account and files the change that ended them.
export async function endAccountSessions(
  deps: AccountWorkspaceDeps<"endSessions">,
  input: { userId: UserId; endedAt: Date; event?: EventToAppend },
): Promise<void> {
  const workspaceIds = await deps.users.listWorkspaceIds(input.userId);
  await Promise.all(
    workspaceIds.map((workspaceId) =>
      deps.workspaces.endSessions(workspaceId, input),
    ),
  );
}

// Files a change to the account's credentials where each workspace's admins
// read it.
export async function recordAccountEvent(
  deps: AccountWorkspaceDeps<"recordEvent">,
  userId: UserId,
  event: EventToAppend,
): Promise<void> {
  const workspaceIds = await deps.users.listWorkspaceIds(userId);
  await Promise.all(
    workspaceIds.map((workspaceId) =>
      deps.workspaces.recordEvent(workspaceId, event),
    ),
  );
}

// The audit of a change the account made to its own credentials.
export function accountChange(
  type: string,
  userId: UserId,
  occurredAt: Date,
): EventToAppend {
  return {
    type,
    entityType: "user",
    entityId: auditEntityId("user", userId),
    actorUserId: userId,
    subjectUserId: userId,
    occurredAt,
  };
}

export function factorEnrolled(
  method: "passkey" | "totp",
  userId: UserId,
  occurredAt: Date,
): EventToAppend {
  const type = method === "passkey" ? "passkey_registered" : "totp_enabled";
  return accountChange(type, userId, occurredAt);
}
