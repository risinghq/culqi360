import type { Role } from "~/domain/auth/access/rbac";
import type { AuthSession } from "~/domain/auth/access/session-types";
import type {
  PrimaryAuthMethod,
  SessionClass,
  StrongAuthMethod,
} from "~/domain/auth/core/session-contract";
import type { BranchId, UserId, WorkspaceId } from "~/domain/ids";
import type { EventToAppend } from "~/server/event-logs/events-repo";
import type { NewUserSessionRow } from "~/server/sessions/repos-sessions";

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
  // The session this one replaces, deleted in the same store write.
  replaces?: string;
}

// A session whose token exists but whose row the workspace store does not hold
// yet. The token is useless until openSession writes the row.
export interface MintedSession {
  workspaceId: WorkspaceId;
  token: string;
  row: NewUserSessionRow;
  replaces?: string;
  // The sign-in's audit, filed when the row is written.
  event?: EventToAppend;
}

export type { AuthSession };
