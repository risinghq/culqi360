import type { ColumnType } from "kysely";

import type { ExecutiveCategory } from "~/domain/identity/executive-category";
import type {
  BranchId,
  IdColumn,
  NullableIdColumn,
  RoleId,
  TeamId,
  UserId,
  WorkspaceId,
} from "~/domain/ids";

export type Role =
  | "executive"
  | "supervisor"
  | "back_office"
  | "sales_manager"
  | "logistics"
  | "hr"
  | "admin"
  | "superuser";

type DefaultedBoolean = ColumnType<boolean, boolean | undefined, boolean>;
type DefaultedNumber = ColumnType<number, number | undefined, number>;

// Platform store. The account id is the member's user_id in every workspace.
export interface AccountsTable {
  id: IdColumn<UserId>;
  username: string;
  email: string;
  password_hash: string;
  password_change_required: DefaultedBoolean;
  is_operator: DefaultedBoolean;
  names: string;
  first_surname: string;
  second_surname: string;
  avatar_storage_key: string | null;
  avatar_mime_type: string | null;
  avatar_updated_at: Date | null;
  avatar_version: DefaultedNumber;
  created_at: Date;
}

export interface MembershipsTable {
  account_id: IdColumn<UserId>;
  workspace_id: IdColumn<WorkspaceId>;
  created_at: Date;
}

export interface WorkspaceRolesTable {
  id: IdColumn<RoleId>;
  key: string;
  name: string;
  kind: Role;
  permissions: ColumnType<string[], string[] | undefined, string[]>;
  locked: DefaultedBoolean;
  created_at: Date;
}

export interface WorkspaceRoleAssignablesTable {
  role_id: IdColumn<RoleId>;
  assignable_role_id: IdColumn<RoleId>;
}

// Workspace store. Names, email and avatar copy the account's.
export interface MembersTable {
  user_id: IdColumn<UserId>;
  branch_id: IdColumn<BranchId>;
  team_id: NullableIdColumn<TeamId>;
  role_id: IdColumn<RoleId>;
  role: Role;
  executive_category: ExecutiveCategory | null;
  is_active: DefaultedBoolean;
  expires_at: Date | null;
  expiry_notified_at: Date | null;
  onboarding_completed_at: Date | null;
  username: string;
  email: string;
  names: string;
  first_surname: string;
  second_surname: string;
  avatar_storage_key: string | null;
  avatar_version: DefaultedNumber;
  created_at: Date;
}
