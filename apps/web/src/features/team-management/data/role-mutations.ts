import { action } from "@solidjs/router";
import { respond } from "@solidjs/web";

import type { CreateRoleInput, UpdateRoleInput } from "~/contracts/roles";
import { roleDetailQuery, rolesListQuery } from "~/rpc/roles/read";
import { createRole, deleteRole, updateRole } from "~/rpc/roles/write";
import { membersRosterQuery } from "~/rpc/team-management/members-roster";

const revalidateRoles = [
  rolesListQuery.key,
  roleDetailQuery.key,
  membersRosterQuery.key,
];

export const createRoleMutation = action(async (input: CreateRoleInput) => {
  const result = await createRole(input);
  return respond(result, { revalidate: revalidateRoles });
}, "createRole");

export const updateRoleMutation = action(async (input: UpdateRoleInput) => {
  const { message } = await updateRole(input);
  return respond({ message }, { revalidate: revalidateRoles });
}, "updateRole");

export const deleteRoleMutation = action(async (roleId: string) => {
  const { message } = await deleteRole(roleId);
  return respond({ message }, { revalidate: revalidateRoles });
}, "deleteRole");
