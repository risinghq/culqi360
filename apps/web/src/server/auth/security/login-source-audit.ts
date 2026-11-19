import { auditEntityId } from "~/domain/audit/entity";
import type { WorkspaceId } from "~/domain/ids";
import type { AuthIdentity } from "~/server/auth/identities";
import { requiresStrongAuthRole } from "~/server/auth/policy/rules/role";
import type { EventToAppend } from "~/server/event-logs/events-repo";
import type { SessionRepository } from "~/server/sessions/repos-sessions";

const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

export type NewLoginSource = {
  workspaceId: WorkspaceId;
  event: EventToAppend;
};

// Detects a privileged login from an IP the account has not used in the
// lookback. Run it before the login's own session exists, or the IP is known.
// The caller files the event through AuthWorkspaces after its platform
// transaction commits; the "security.privileged_login" notification policy
// decides who hears about it.
export async function detectNewLoginSource(params: {
  user: Pick<
    AuthIdentity,
    | "id"
    | "workspace_id"
    | "email"
    | "names"
    | "first_surname"
    | "second_surname"
    | "role"
  >;
  ipAddress: string;
  method: string;
  occurredAt: Date;
  sessions: Pick<SessionRepository, "hasRecentForAccountAndIp">;
}): Promise<NewLoginSource | null> {
  if (!requiresStrongAuthRole(params.user.role)) {
    return null;
  }

  const knownIp = await params.sessions.hasRecentForAccountAndIp(
    params.user.id,
    params.ipAddress,
    new Date(params.occurredAt.getTime() - LOOKBACK_MS),
  );
  if (knownIp) {
    return null;
  }

  return {
    workspaceId: params.user.workspace_id,
    event: {
      type: "security.privileged_login",
      entityType: "user",
      entityId: auditEntityId("user", params.user.id),
      actorUserId: params.user.id,
      subjectUserId: params.user.id,
      payload: {
        ipAddress: params.ipAddress,
        method: params.method,
        role: params.user.role,
        names: params.user.names,
        firstSurname: params.user.first_surname,
        secondSurname: params.user.second_surname,
        email: params.user.email,
      },
      occurredAt: params.occurredAt,
    },
  };
}
