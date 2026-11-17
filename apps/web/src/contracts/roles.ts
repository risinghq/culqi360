import type { Permission, Role } from "~/domain/auth/access/rbac";

export interface RoleListItem {
  id: string;
  name: string;
  kind: Role;
  locked: boolean;
  memberCount: number;
}

export interface RolesList {
  roles: RoleListItem[];
  // The kinds a new role may take; empty when the viewer cannot create one.
  creatableKinds: Role[];
}

export interface RoleDetail {
  id: string;
  key: string;
  name: string;
  kind: Role;
  locked: boolean;
  memberCount: number;
  permissions: readonly Permission[];
  // The permissions the workspace's modules allow; the editor offers only these.
  availablePermissions: readonly Permission[];
  assignableRoleIds: string[];
  // The admin kinds assign every role, so their list is not edited.
  assignsEveryRole: boolean;
  otherRoles: { id: string; name: string }[];
  canEdit: boolean;
}

export interface CreateRoleInput {
  name: string;
  kind: string;
}

export interface UpdateRoleInput {
  roleId: string;
  name: string;
  permissions: string[];
  assignableRoleIds: string[];
}
