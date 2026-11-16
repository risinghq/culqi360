import type { Generated } from "kysely";

import type {
  BranchId,
  GeneratedId,
  IdColumn,
  TeamId,
  UserId,
  WorkspaceId,
} from "~/domain/ids";

export interface WorkspacesTable {
  id: GeneratedId<WorkspaceId>;
  name: string;
  // WorkspaceModule names; see domain/auth/access/workspace-modules.ts.
  modules: Generated<string[]>;
  created_at: Date;
}

export interface BranchesTable {
  id: GeneratedId<BranchId>;
  name: string;
  created_at: Date;
}

export interface TeamsTable {
  id: GeneratedId<TeamId>;
  branch_id: IdColumn<BranchId>;
  name: string;
  created_at: Date;
}

export interface BranchSupervisorsTable {
  id: Generated<string>;
  branch_id: IdColumn<BranchId>;
  user_id: IdColumn<UserId>;
  created_at: Date;
}

export interface BackOfficeAssignmentsTable {
  id: Generated<string>;
  back_office_user_id: IdColumn<UserId>;
  team_id: IdColumn<TeamId>;
  assigned_at: Date;
}
