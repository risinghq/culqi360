import type { Kysely } from "kysely";

import type { RoleId } from "~/domain/ids";
import { createEventsWriter } from "~/server/event-logs/events-repo";
import type { AppContext } from "~/server/platform/action/context";
import type { WorkspaceDatabase } from "~/server/platform/database/types";
import { createExecutorUow } from "~/server/platform/database/uow";

import {
  createRole,
  deleteRole,
  getRoleDetail,
  listRoles,
  updateRole,
  type CreateRoleCommand,
  type RolesAdminDeps,
  type UpdateRoleCommand,
} from "./application/roles-admin";
import { createRolesRepo } from "./repos-roles";

export function createRolesRuntime(db: Kysely<WorkspaceDatabase>) {
  const deps: RolesAdminDeps = {
    roles: createRolesRepo(db),
    uow: createExecutorUow(db, (tx) => ({
      roles: createRolesRepo(tx),
      events: createEventsWriter(tx),
    })),
  };

  return {
    list: (ctx: AppContext) => listRoles(ctx, deps),
    getDetail: (ctx: AppContext, roleId: RoleId) =>
      getRoleDetail(ctx, deps, roleId),
    create: (ctx: AppContext, command: CreateRoleCommand) =>
      createRole(ctx, deps, command),
    update: (ctx: AppContext, command: UpdateRoleCommand) =>
      updateRole(ctx, deps, command),
    remove: (ctx: AppContext, roleId: RoleId) => deleteRole(ctx, deps, roleId),
  };
}
