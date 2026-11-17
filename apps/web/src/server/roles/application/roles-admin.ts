import type { RoleDetail, RolesList } from "~/contracts/roles";
import { auditEntityId } from "~/domain/audit/entity";
import {
  assignsEveryRole,
  BASELINE_PERMISSIONS,
  hasPermission,
  PERMISSIONS,
  type Permission,
  type Role,
} from "~/domain/auth/access/rbac";
import {
  CUSTOM_ROLE_KINDS,
  canGrantPermissions,
  isCustomRoleKind,
  knownPermissions,
  roleKeyFromName,
} from "~/domain/auth/access/role-admin";
import { effectivePermissions } from "~/domain/auth/access/workspace-modules";
import { fail, type DomainError } from "~/domain/errors";
import type { RoleId } from "~/domain/ids";
import type { EventsWriter } from "~/server/event-logs/events-repo";
import type { AppContext } from "~/server/platform/action/context";
import type { AppUow } from "~/server/platform/database/uow";
import { Err, isErr, Ok, type Result } from "~/shared/result";

import type { RolesRepo } from "../repos-roles";

export interface RolesTx {
  roles: RolesRepo;
  events: EventsWriter;
}

export interface RolesAdminDeps {
  roles: RolesRepo;
  uow: AppUow<RolesTx>;
}

export interface CreateRoleCommand {
  name: string;
  kind: Role;
}

export interface UpdateRoleCommand {
  roleId: RoleId;
  name: string;
  permissions: readonly string[];
  assignableRoleIds: readonly RoleId[];
}

function canManageRoles(ctx: AppContext): boolean {
  return hasPermission(ctx.actor, "role:manage");
}

function availablePermissions(ctx: AppContext): Permission[] {
  return effectivePermissions(PERMISSIONS, ctx.actor.modules);
}

export async function listRoles(
  ctx: AppContext,
  deps: RolesAdminDeps,
): Promise<Result<RolesList, DomainError>> {
  const rows = await deps.roles.list();
  return Ok({
    roles: rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      locked: row.locked,
      memberCount: Number(row.member_count ?? 0),
    })),
    creatableKinds: canManageRoles(ctx) ? [...CUSTOM_ROLE_KINDS] : [],
  });
}

export async function getRoleDetail(
  ctx: AppContext,
  deps: RolesAdminDeps,
  roleId: RoleId,
): Promise<Result<RoleDetail, DomainError>> {
  const rows = await deps.roles.list();
  const role = rows.find((row) => row.id === roleId);
  if (!role) {
    return Err(fail("role_not_found"));
  }
  return Ok({
    id: role.id,
    key: role.key,
    name: role.name,
    kind: role.kind,
    locked: role.locked,
    memberCount: Number(role.member_count ?? 0),
    permissions: knownPermissions(role.permissions),
    availablePermissions: availablePermissions(ctx),
    assignableRoleIds: await deps.roles.listAssignableIds(role.id),
    assignsEveryRole: assignsEveryRole(role.kind),
    otherRoles: rows
      .filter((row) => row.id !== role.id && row.kind !== "superuser")
      .map((row) => ({ id: row.id, name: row.name })),
    canEdit: canManageRoles(ctx) && !role.locked,
  });
}

// A new role starts from its kind's baseline permissions, less any the creator
// does not hold.
export async function createRole(
  ctx: AppContext,
  deps: RolesAdminDeps,
  command: CreateRoleCommand,
): Promise<Result<RoleId, DomainError>> {
  if (!isCustomRoleKind(command.kind)) {
    return Err(fail("role_kind_not_allowed"));
  }
  const key = roleKeyFromName(command.name);
  if (key === "") {
    return Err(fail("role_name_invalid"));
  }

  return deps.uow.run(async (tx) => {
    if (await tx.roles.findByKey(key)) {
      return Err(fail("role_key_taken"));
    }
    const permissions = BASELINE_PERMISSIONS[command.kind].filter(
      (permission) => hasPermission(ctx.actor, permission),
    );
    const id = await tx.roles.create({
      key,
      name: command.name.trim(),
      kind: command.kind,
      permissions,
      createdAt: ctx.operationAt,
    });
    await tx.events.append({
      type: "role_created",
      entityType: "role",
      entityId: auditEntityId("role", id),
      actorUserId: ctx.actor.userId,
      payload: { key, kind: command.kind },
      occurredAt: ctx.operationAt,
    });
    return Ok(id);
  });
}

// Sessions read the role on every request, so an edit applies to its members
// at once without closing their sessions.
export async function updateRole(
  ctx: AppContext,
  deps: RolesAdminDeps,
  command: UpdateRoleCommand,
): Promise<Result<void, DomainError>> {
  const name = command.name.trim();
  if (roleKeyFromName(name) === "") {
    return Err(fail("role_name_invalid"));
  }

  return deps.uow.run(async (tx) => {
    const role = await tx.roles.findById(command.roleId);
    if (!role) {
      return Err(fail("role_not_found"));
    }
    if (role.locked) {
      return Err(fail("role_locked"));
    }

    const permissions = nextPermissions(
      role.permissions,
      knownPermissions(command.permissions),
      availablePermissions(ctx),
    );
    if (!canGrantPermissions(ctx.actor, role.permissions, permissions)) {
      return Err(fail("permission_not_grantable"));
    }

    const assignable = await assignableIds(tx.roles, role, command);
    if (isErr(assignable)) {
      return assignable;
    }

    await tx.roles.update(role.id, { name, permissions });
    if (assignable.value !== null) {
      await tx.roles.setAssignableIds(role.id, assignable.value);
    }
    await tx.events.append({
      type: "role_updated",
      entityType: "role",
      entityId: auditEntityId("role", role.id),
      actorUserId: ctx.actor.userId,
      payload: { key: role.key, permissions },
      occurredAt: ctx.operationAt,
    });
    return Ok(undefined);
  });
}

export async function deleteRole(
  ctx: AppContext,
  deps: RolesAdminDeps,
  roleId: RoleId,
): Promise<Result<void, DomainError>> {
  return deps.uow.run(async (tx) => {
    const role = await tx.roles.findById(roleId);
    if (!role) {
      return Err(fail("role_not_found"));
    }
    if (role.locked) {
      return Err(fail("role_locked"));
    }
    if ((await tx.roles.countMembers(role.id)) > 0) {
      return Err(fail("role_has_members"));
    }
    if ((await tx.roles.countOwnedStages(role.key)) > 0) {
      return Err(fail("role_owns_stage"));
    }

    await tx.roles.delete(role.id);
    await tx.events.append({
      type: "role_deleted",
      entityType: "role",
      entityId: auditEntityId("role", role.id),
      actorUserId: ctx.actor.userId,
      payload: { key: role.key, kind: role.kind },
      occurredAt: ctx.operationAt,
    });
    return Ok(undefined);
  });
}

// The editor shows only the permissions the workspace's modules allow. Stored
// permissions outside them stay, so adding a module later restores them.
function nextPermissions(
  current: readonly string[],
  submitted: readonly Permission[],
  available: readonly Permission[],
): Permission[] {
  const hidden = knownPermissions(current).filter(
    (permission) => !available.includes(permission),
  );
  const shown = submitted.filter((permission) =>
    available.includes(permission),
  );
  return [...hidden, ...shown];
}

// Foreign keys bypass row-level security, so each id is checked against the
// workspace's own roles before it is stored. Null leaves the list unchanged.
async function assignableIds(
  roles: RolesRepo,
  role: { kind: Role },
  command: UpdateRoleCommand,
): Promise<Result<RoleId[] | null, DomainError>> {
  if (assignsEveryRole(role.kind)) {
    return Ok(null);
  }
  const workspaceRoles = await roles.list();
  const ids = [...new Set(command.assignableRoleIds)];
  const valid = ids.every((id) =>
    workspaceRoles.some((row) => row.id === id && row.kind !== "superuser"),
  );
  return valid ? Ok(ids) : Err(fail("role_not_assignable"));
}
