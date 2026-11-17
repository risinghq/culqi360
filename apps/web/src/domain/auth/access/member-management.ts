import type { RoleId } from "~/domain/ids";

import {
  assignsEveryRole,
  hasPermission,
  type PermissionHolder,
  type Role,
} from "./rbac";

// Identity checks need the actor and target ids; they live in the use-cases.

// A workspace role as the assignment rules see it.
export interface RoleRef {
  id: RoleId;
  kind: Role;
}

// The acting member: their role's kind, permissions, and the roles their role
// may assign.
export interface RoleAssigner extends PermissionHolder {
  role: Role;
  assignableRoleIds: readonly RoleId[];
}

// The admin kinds assign every role but a superuser one. Other roles assign
// what their workspace role lists.
export function canAssignRole(actor: RoleAssigner, target: RoleRef): boolean {
  if (assignsEveryRole(actor.role)) {
    return target.kind !== "superuser";
  }
  return actor.assignableRoleIds.includes(target.id);
}

// A workspace role the actor may pick in a form. `kind` decides the fields
// the form shows, such as an executive's category.
export interface RoleOption {
  value: RoleId;
  label: string;
  kind: Role;
}

export function assignableRoleOptions(
  actor: RoleAssigner,
  roles: readonly (RoleRef & { name: string })[],
): RoleOption[] {
  return roles
    .filter((role) => canAssignRole(actor, role))
    .map((role) => ({ value: role.id, label: role.name, kind: role.kind }));
}

export function canManageMember(actor: RoleAssigner, target: RoleRef): boolean {
  return hasPermission(actor, "team:manage") && canAssignRole(actor, target);
}

export function canDeleteMember(actor: RoleAssigner, target: RoleRef): boolean {
  return canManageMember(actor, target) && target.kind !== "superuser";
}

export function canImpersonateMember(
  actor: PermissionHolder,
  target: RoleRef,
): boolean {
  return hasPermission(actor, "admin:manage") && target.kind !== "superuser";
}
