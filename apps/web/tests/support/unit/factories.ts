import { BASELINE_PERMISSIONS } from "~/domain/auth/access/rbac";
import type { AuthSession } from "~/domain/auth/access/session-types";
import { effectivePermissions } from "~/domain/auth/access/workspace-modules";
import { BranchId, RoleId, UserId, WorkspaceId } from "~/domain/ids";
import type { AppContext } from "~/server/platform/action/context";

// The role fields default to the baseline role of the given kind, so a test
// that overrides `role` gets that role's permissions, limited to `modules`.
export function makeAuthSession(
  overrides: Partial<AuthSession> = {},
): AuthSession {
  const role = overrides.role ?? "executive";
  const modules = overrides.modules ?? ["culqi", "contacts"];
  return {
    id: "test-session-id",
    workspaceId: WorkspaceId.trust("unit-workspace"),
    userId: UserId.trust("unit-user"),
    branchId: BranchId.trust("unit-branch"),
    role,
    roleId: RoleId.trust(`unit-role-${role}`),
    roleKey: role,
    roleName: role,
    permissions: effectivePermissions(BASELINE_PERMISSIONS[role], modules),
    assignableRoleIds: [],
    modules,
    sessionClass: "app",
    primaryAuthMethod: "password",
    strongAuthMethod: null,
    strongAuthAt: null,
    ...overrides,
    impersonatorUserId: overrides.impersonatorUserId ?? null,
  };
}

export const makeActor = makeAuthSession;

export function makeAppContext(
  overrides: Partial<AppContext> = {},
): AppContext {
  return {
    actor: makeActor(),
    requestId: "test-req-id",
    traceId: "test-trace-id",
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
    publicOrigin: "http://localhost:3000",
    operationAt: new Date(1_700_000_000_000),
    ...overrides,
  };
}
