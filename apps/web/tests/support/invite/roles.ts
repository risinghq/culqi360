import type { RoleAssigner } from "~/domain/auth/access/member-management";
import { BASELINE_PERMISSIONS } from "~/domain/auth/access/rbac";
import type { RoleId } from "~/domain/ids";

import type { TestDbContext } from "../runtime/db";

export const SUPERUSER_ASSIGNER: RoleAssigner = {
  role: "superuser",
  permissions: BASELINE_PERMISSIONS.superuser,
  assignableRoleIds: [],
};

export async function roleIdByKey(
  ctx: Pick<TestDbContext, "repos">,
  key: string,
): Promise<RoleId> {
  const role = await ctx.repos.roles.findByKey(key);
  if (!role) {
    throw new Error(`fixture workspace has no role ${key}`);
  }
  return role.id;
}
