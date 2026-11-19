import type { ColumnType } from "kysely";

import type {
  BranchId,
  IdColumn,
  TeamId,
  UserId,
  WorkspaceId,
} from "~/domain/ids";

export interface WorkspacesTable {
  id: IdColumn<WorkspaceId>;
  name: string;
  created_at: Date;
}

// One row: the modules this workspace runs. WorkspaceModule names; see
// domain/auth/access/workspace-modules.ts.
export interface WorkspaceSettingsTable {
  id: 1;
  modules: ColumnType<string[], string[] | undefined, string[]>;
}

// Kapso posts every inbound message to one webhook; the receiving number
// names the workspace.
export interface WhatsAppNumbersTable {
  phone_number_id: string;
  workspace_id: IdColumn<WorkspaceId>;
}

export interface BranchesTable {
  id: IdColumn<BranchId>;
  name: string;
  created_at: Date;
}

export interface TeamsTable {
  id: IdColumn<TeamId>;
  branch_id: IdColumn<BranchId>;
  name: string;
  created_at: Date;
}

export interface BranchSupervisorsTable {
  id: string;
  branch_id: IdColumn<BranchId>;
  user_id: IdColumn<UserId>;
  created_at: Date;
}

export interface BackOfficeTeamsTable {
  id: string;
  back_office_user_id: IdColumn<UserId>;
  team_id: IdColumn<TeamId>;
  assigned_at: Date;
}
