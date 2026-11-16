import type { BranchId, UserId, WorkspaceId } from "~/domain/ids";

import type {
  PrimaryAuthMethod,
  SessionClass,
  StrongAuthMethod,
} from "../core/session-contract";
import type { Role } from "./rbac";
import type { WorkspaceModule } from "./workspace-modules";

export interface AuthSession {
  id: string;
  userId: UserId;
  workspaceId: WorkspaceId;
  modules: readonly WorkspaceModule[];
  branchId: BranchId;
  role: Role;
  sessionClass: SessionClass;
  primaryAuthMethod: PrimaryAuthMethod;
  strongAuthMethod: StrongAuthMethod | null;
  strongAuthAt: Date | null;
  impersonatorUserId: UserId | null;
}
