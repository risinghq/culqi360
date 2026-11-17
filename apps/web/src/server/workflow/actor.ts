import type { Permission, Role } from "~/domain/auth/access/rbac";
import type { BranchId, UserId } from "~/domain/ids";

export type WorkflowActor = {
  userId: UserId;
  role: Role;
  permissions: readonly Permission[];
  branchId: BranchId;
};
