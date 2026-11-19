import type { Permission, Role } from "~/domain/auth/access/rbac";
import type { AuthSession } from "~/domain/auth/access/session-types";
import type { WorkspaceModule } from "~/domain/auth/access/workspace-modules";
import type { BranchId, RoleId, WorkspaceId } from "~/domain/ids";
import type { UserSessionRow } from "~/server/sessions/repos-sessions";

type PersistedSessionSource = Pick<
  UserSessionRow,
  | "user_id"
  | "session_class"
  | "primary_auth_method"
  | "strong_auth_method"
  | "strong_auth_at"
  | "impersonator_user_id"
>;

// The member's workspace, branch and role as the session reads them on each
// request.
export interface SessionMember {
  workspaceId: WorkspaceId;
  modules: readonly WorkspaceModule[];
  branchId: BranchId;
  role: Role;
  roleId: RoleId;
  roleKey: string;
  roleName: string;
  permissions: readonly Permission[];
  assignableRoleIds: readonly RoleId[];
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
    sessionClass: session.session_class,
    primaryAuthMethod: session.primary_auth_method,
    strongAuthMethod: session.strong_auth_method,
    strongAuthAt: session.strong_auth_at,
    impersonatorUserId: session.impersonator_user_id,
  };
}
