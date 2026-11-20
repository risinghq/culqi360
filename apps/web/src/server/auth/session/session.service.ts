import { auditEntityId } from "~/domain/audit/entity";
import { addMilliseconds } from "~/domain/time/clock";
import type { AuthWorkspaces } from "~/server/auth/application/ports";
import {
  generateSessionToken,
  hashSessionToken,
} from "~/server/auth/session/tokens";
import type { OperationContext } from "~/server/platform/operation/context";
import type { NewLoginSourceAudit } from "~/server/sessions/workspace-sessions";

import { SESSION_DURATION_MS } from "./lifetime";
import type { MintedSession, SessionSpec } from "./session-spec";

// The cookie token and the row the member's workspace store keeps for it.
// Minting writes nothing, so a flow mints inside its platform transaction and
// opens the session after that transaction commits.
export function mintSession(
  spec: SessionSpec,
  operation: OperationContext,
): MintedSession {
  const token = generateSessionToken(spec.user.workspace_id);
  return {
    workspaceId: spec.user.workspace_id,
    token,
    replaces: spec.replaces,
    row: {
      id: hashSessionToken(token),
      user_id: spec.user.id,
      session_class: spec.sessionClass,
      primary_auth_method: spec.primaryAuthMethod,
      strong_auth_method: spec.strongAuthMethod,
      strong_auth_at: spec.strongAuthAt,
      impersonator_user_id: spec.impersonatorUserId ?? null,
      ip_address: spec.request.ipAddress,
      user_agent: spec.request.userAgent,
      created_at: operation.operationAt,
      last_activity: operation.operationAt,
      expires_at: addMilliseconds(operation.operationAt, SESSION_DURATION_MS),
    },
  };
}

// Writes the session row and returns the cookie token. A login passes its
// source audit, which the same workspace write files when the IP is new.
export async function openMintedSession(
  workspaces: Pick<AuthWorkspaces, "openSession">,
  minted: MintedSession,
  ifNewIp?: NewLoginSourceAudit,
): Promise<string> {
  await workspaces.openSession(minted.workspaceId, {
    session: minted.row,
    replaces: minted.replaces,
    event: minted.event,
    ifNewIp,
  });
  return minted.token;
}

// Mints a sign-in's session with its login event, which the workspace files
// when it opens the session.
export function mintLogin(
  spec: SessionSpec,
  operation: OperationContext,
): MintedSession {
  return {
    ...mintSession(spec, operation),
    event: {
      type: spec.primaryAuthMethod === "passkey" ? "login_passkey" : "login",
      entityType: "user",
      entityId: auditEntityId("user", spec.user.id),
      actorUserId: spec.user.id,
      occurredAt: operation.operationAt,
    },
  };
}
