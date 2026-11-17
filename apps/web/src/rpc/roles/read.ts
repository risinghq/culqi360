import { query } from "@solidjs/router";

import { getRoleDetail, getRolesList } from "~/server/roles/ui/queries";

export const rolesListQuery = query(async () => {
  "use server";
  return getRolesList();
}, "roles.list");

export const roleDetailQuery = query(async (roleId: unknown) => {
  "use server";
  return getRoleDetail(roleId);
}, "roles.detail");
