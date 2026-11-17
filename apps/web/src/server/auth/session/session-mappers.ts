import type { Selectable } from "kysely";

import type { Permission, Role } from "~/domain/auth/access/rbac";
import type { AuthSession } from "~/domain/auth/access/session-types";
import type { WorkspaceModule } from "~/domain/auth/access/workspace-modules";
import type { BranchId, RoleId, UserId, WorkspaceId } from "~/domain/ids";
import type { Database, UsersTable } from "~/server/platform/database/types";

type UserRow = Selectable<UsersTable>;
type UserSessionRow = Selectable<Database["user_sessions"]>;

type SessionIdentitySource = Pick<
  UserRow,
  "id" | "branch_id" | "role" | "onboarding_completed_at"
>;

type PersistedSessionSource = Pick<
  UserSessionRow,
  | "user_id"
  | "branch_id"
  | "session_class"
  | "primary_auth_method"
  | "strong_auth_method"
  | "strong_auth_at"
  | "impersonator_user_id"
>;

// The member's workspace and role as the session reads them on each request.
export interface SessionMember {
  workspaceId: WorkspaceId;
  modules: readonly WorkspaceModule[];
  role: Role;
  roleId: RoleId;
  roleKey: string;
  roleName: string;
  permissions: readonly Permission[];
  assignableRoleIds: readonly RoleId[];
}

export interface SessionIdentity {
  userId: UserId;
  branchId: BranchId;
  role: UserRow["role"];
}

export function mapUserToSessionIdentity(
  user: SessionIdentitySource,
): SessionIdentity {
  return {
    userId: user.id,
    branchId: user.branch_id,
    role: user.role,
  };
}

export function mapUserSessionRowToAuthSession(
  sessionId: string,
  member: SessionMember,
  session: PersistedSessionSource,
): AuthSession {
  return {
    id: sessionId,
    userId: session.user_id,
    ...member,
    branchId: session.branch_id,
    sessionClass: session.session_class,
    primaryAuthMethod: session.primary_auth_method,
    strongAuthMethod: session.strong_auth_method,
    strongAuthAt: session.strong_auth_at,
    impersonatorUserId: session.impersonator_user_id,
  };
}
