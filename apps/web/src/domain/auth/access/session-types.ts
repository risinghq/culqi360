import type { BranchId, RoleId, UserId, WorkspaceId } from "~/domain/ids";

import type {
  PrimaryAuthMethod,
  SessionClass,
  StrongAuthMethod,
} from "../core/session-contract";
import type { Permission, Role } from "./rbac";
import type { WorkspaceModule } from "./workspace-modules";

// `role` is the kind of the member's workspace role. `permissions` are the
// role's permissions that the workspace's modules allow.
export interface AuthSession {
  id: string;
  userId: UserId;
  workspaceId: WorkspaceId;
  modules: readonly WorkspaceModule[];
  branchId: BranchId;
  role: Role;
  roleId: RoleId;
  roleKey: string;
  roleName: string;
  permissions: readonly Permission[];
  assignableRoleIds: readonly RoleId[];
  sessionClass: SessionClass;
  primaryAuthMethod: PrimaryAuthMethod;
  strongAuthMethod: StrongAuthMethod | null;
  strongAuthAt: Date | null;
  impersonatorUserId: UserId | null;
}
