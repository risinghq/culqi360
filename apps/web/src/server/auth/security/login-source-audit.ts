import { auditEntityId } from "~/domain/audit/entity";
import type { AuthIdentity } from "~/server/auth/identities";
import { requiresStrongAuthRole } from "~/server/auth/policy/rules/role";
import type { NewLoginSourceAudit } from "~/server/sessions/workspace-sessions";

const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

// The event a privileged login files when its IP opened no session of the
// account in the lookback. The workspace store checks the IP and opens the
// session in one write; the "security.privileged_login" notification policy
// decides who hears about it.
export function loginSourceAudit(params: {
  user: Pick<
    AuthIdentity,
    "id" | "email" | "names" | "first_surname" | "second_surname" | "role"
  >;
  ipAddress: string;
  method: string;
  occurredAt: Date;
}): NewLoginSourceAudit | undefined {
  if (!requiresStrongAuthRole(params.user.role)) {
    return undefined;
  }
  return {
    since: new Date(params.occurredAt.getTime() - LOOKBACK_MS),
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
