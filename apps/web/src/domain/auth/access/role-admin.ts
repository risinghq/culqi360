import {
  hasPermission,
  isPermission,
  ROLES,
  type Permission,
  type PermissionHolder,
  type Role,
} from "./rbac";

// A workspace may create roles of every kind but superuser, which stays the
// platform operator's.
export const CUSTOM_ROLE_KINDS: readonly Role[] = ROLES.filter(
  (kind) => kind !== "superuser",
);

export function isCustomRoleKind(kind: Role): boolean {
  return CUSTOM_ROLE_KINDS.includes(kind);
}

// The key is fixed at creation: case stages name their owner by it.
export function roleKeyFromName(name: string): string {
  return name
    .normalize("NFD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
}

// An editor grants only what they hold, so role:manage cannot escalate past
// its holder. Permissions the role already has stay, held or not.
export function canGrantPermissions(
  editor: PermissionHolder,
  current: readonly string[],
  next: readonly Permission[],
): boolean {
  return next.every(
    (permission) =>
      current.includes(permission) || hasPermission(editor, permission),
  );
}

export function knownPermissions(values: readonly string[]): Permission[] {
  return [...new Set(values.filter(isPermission))];
}
