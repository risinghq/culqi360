import type { Role } from "~/domain/auth/access/rbac";
import type { AuthSession } from "~/domain/auth/access/session-types";
import type {
  PrimaryAuthMethod,
  SessionClass,
  StrongAuthMethod,
} from "~/domain/auth/core/session-contract";
import type { BranchId, UserId, WorkspaceId } from "~/domain/ids";
import type { AuthWorkspaces } from "~/server/auth/application/ports";
import type { PlatformEventToAppend } from "~/server/event-logs/platform-events-repo";
import type { UserSessionRow } from "~/server/sessions/repos-sessions";
import type { Logger } from "~/shared/observability/logger";

export interface SessionUser {
  id: UserId;
  workspace_id: WorkspaceId;
  branch_id: BranchId;
  role: Role;
  onboarding_completed_at: Date | null;
}

export interface SessionRequestMetadata {
  ipAddress: string;
  userAgent: string | null;
}

export interface SessionSpec {
  user: SessionUser;
  sessionClass: SessionClass;
  request: SessionRequestMetadata;
  primaryAuthMethod: PrimaryAuthMethod;
  strongAuthMethod: StrongAuthMethod | null;
  strongAuthAt: Date | null;
  impersonatorUserId?: UserId | null;
}

export interface AuditedSessionSpec extends SessionSpec {
  auditAction: "login" | "login_passkey";
}

export interface IssuedSession {
  userId: UserId;
  role: Role;
  sessionClass: SessionClass;
  primaryAuthMethod: PrimaryAuthMethod;
  strongAuthMethod: StrongAuthMethod | null;
  strongAuthAt: Date | null;
  token: string;
}

export interface SessionRepositoryPort {
  create(session: {
    id: string;
    account_id: UserId;
    workspace_id: WorkspaceId;
    session_class: SessionClass;
    primary_auth_method: PrimaryAuthMethod;
    strong_auth_method: StrongAuthMethod | null;
    strong_auth_at: Date | null;
    impersonator_account_id: UserId | null;
    ip_address: string | null;
    user_agent: string | null;
    created_at: Date;
    last_activity: Date;
    expires_at: Date;
  }): Promise<void>;
  findById(id: string): Promise<UserSessionRow | null>;
  updateActivity(id: string, lastActivity: Date): Promise<void>;
  extendExpiry(id: string, expiresAt: Date): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface SessionEventPort {
  // Service does not read the return; adapters can return void, an id, or an
  // event count without breaking the contract.
  append(event: PlatformEventToAppend): Promise<unknown>;
}

export interface SessionAuthenticatorDeps {
  sessions: SessionRepositoryPort;
  workspaces: Pick<AuthWorkspaces, "findMember">;
  logger?: Pick<Logger, "error">;
}

export interface SessionIssuerDeps {
  sessions: Pick<SessionRepositoryPort, "create">;
}

export interface AuditedSessionIssuerDeps extends SessionIssuerDeps {
  events: SessionEventPort;
}

export type { AuthSession };
