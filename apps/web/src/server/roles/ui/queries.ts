import type { RoleDetail, RolesList } from "~/contracts/roles";
import { RoleId } from "~/domain/ids";
import { getApplication } from "~/server/composition/application";
import { executeSessionServerFunction } from "~/server/platform/action";
import {
  parseObject,
  validationFail,
} from "~/server/platform/action/input-reader";

export async function getRolesList(): Promise<RolesList> {
  return executeSessionServerFunction({
    name: "roles.list.read",
    access: { kind: "permission", permission: "team:read" },
    execute: (ctx) => getApplication().roles.list(ctx),
  });
}

export async function getRoleDetail(rawRoleId: unknown): Promise<RoleDetail> {
  return executeSessionServerFunction({
    name: "roles.detail.read",
    access: { kind: "permission", permission: "team:read" },
    parse: () =>
      parseObject({ roleId: rawRoleId }, validationFail, (r) => ({
        roleId: r.id("roleId", RoleId),
      })),
    execute: (ctx, command) =>
      getApplication().roles.getDetail(ctx, command.roleId),
  });
}
