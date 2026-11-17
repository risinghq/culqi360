import { CUSTOM_ROLE_KINDS } from "~/domain/auth/access/role-admin";
import { RoleId } from "~/domain/ids";
import { getApplication } from "~/server/composition/application";
import { executeSessionServerFunction } from "~/server/platform/action";
import {
  parseObject,
  validationFail,
} from "~/server/platform/action/input-reader";
import { isErr, Ok } from "~/shared/result";

const ROLE_NAME = { min: 1, max: 60 };
const ROLE_LIST = { unique: true, max: 100 };

export async function createRole(
  input: unknown,
): Promise<{ message: string; roleId: string }> {
  "use server";

  return executeSessionServerFunction({
    name: "roles.create",
    access: { kind: "permission", permission: "role:manage" },

    parse: () =>
      parseObject(input, validationFail, (r) => ({
        name: r.str("name", ROLE_NAME),
        kind: r.enum("kind", CUSTOM_ROLE_KINDS),
      })),

    telemetry: ({ kind }) => ({ kind }),

    execute: async (ctx, command) => {
      const result = await getApplication().roles.create(ctx, command);
      if (isErr(result)) {
        return result;
      }
      return Ok({ message: "Rol creado", roleId: result.value });
    },
  });
}

export async function updateRole(input: unknown): Promise<{ message: string }> {
  "use server";

  return executeSessionServerFunction({
    name: "roles.update",
    access: { kind: "permission", permission: "role:manage" },

    parse: () =>
      parseObject(input, validationFail, (r) => ({
        roleId: r.id("roleId", RoleId),
        name: r.str("name", ROLE_NAME),
        permissions: r.strList("permissions", ROLE_LIST),
        assignableRoleIds: r.idList("assignableRoleIds", RoleId, ROLE_LIST),
      })),

    telemetry: ({ roleId }) => ({ roleId }),

    execute: async (ctx, command) => {
      const result = await getApplication().roles.update(ctx, command);
      if (isErr(result)) {
        return result;
      }
      return Ok({ message: "Rol actualizado" });
    },
  });
}

export async function deleteRole(
  rawRoleId: unknown,
): Promise<{ message: string }> {
  "use server";

  return executeSessionServerFunction({
    name: "roles.delete",
    access: { kind: "permission", permission: "role:manage" },

    parse: () =>
      parseObject({ roleId: rawRoleId }, validationFail, (r) => ({
        roleId: r.id("roleId", RoleId),
      })),

    telemetry: ({ roleId }) => ({ roleId }),

    execute: async (ctx, { roleId }) => {
      const result = await getApplication().roles.remove(ctx, roleId);
      if (isErr(result)) {
        return result;
      }
      return Ok({ message: "Rol eliminado" });
    },
  });
}
