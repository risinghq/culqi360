import type { ExecutiveCategory } from "~/domain/identity/executive-category";
import type {
  AuthLoginFlowId,
  BranchId,
  IdColumn,
  NullableIdColumn,
  RecoveryCodeId,
  RecoveryCodeSetId,
  RoleId,
  TeamId,
  UserId,
  UserInviteId,
  WebauthnChallengeId,
  WorkspaceId,
} from "~/domain/ids";

export type AuthMethodValue = "password" | "google" | "passkey";

export interface LoginFlowsTable {
  id: IdColumn<AuthLoginFlowId>;
  identifier: string;
  primary_auth_method: AuthMethodValue;
  account_id: NullableIdColumn<UserId>;
  challenge_id: NullableIdColumn<WebauthnChallengeId>;
  state: "totp" | "passkey";
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface PasskeysTable {
  id: string;
  account_id: IdColumn<UserId>;
  public_key: string;
  counter: number;
  transports: string | null;
  created_at: Date;
  last_used_at: Date | null;
}

export interface WebauthnChallengesTable {
  id: IdColumn<WebauthnChallengeId>;
  account_id: NullableIdColumn<UserId>;
  type: string;
  challenge: string;
  expires_at: Date;
  created_at: Date;
}

export interface UserOAuthAccountsTable {
  id: string;
  account_id: IdColumn<UserId>;
  provider: string;
  provider_user_id: string;
  email: string;
  created_at: Date;
}

export interface PasswordResetTokensTable {
  id: string;
  account_id: IdColumn<UserId>;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

export interface UserSessionsTable {
  id: string;
  account_id: IdColumn<UserId>;
  workspace_id: IdColumn<WorkspaceId>;
  session_class: "pre_auth" | "recovery_setup" | "app";
  primary_auth_method: AuthMethodValue;
  strong_auth_method: "totp" | "passkey" | "federated" | "recovery" | null;
  strong_auth_at: Date | null;

  // Identifies the operator session to restore after impersonation ends.
  impersonator_account_id: NullableIdColumn<UserId>;

  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
  last_activity: Date;
  expires_at: Date;
}

export interface UserTotpFactorsTable {
  id: string;
  account_id: IdColumn<UserId>;
  secret_encrypted: string;
  is_enabled: boolean;
  created_at: Date;
  updated_at: Date;
  enabled_at: Date | null;
}

export type RecoveryCodeSetSource = "enroll" | "regenerate";

export interface RecoveryCodeSetTable {
  id: IdColumn<RecoveryCodeSetId>;
  account_id: IdColumn<UserId>;
  source: RecoveryCodeSetSource;
  created_at: Date;
  acknowledged_at: Date | null;
  revoked_at: Date | null;
}

export interface RecoveryCodeTable {
  id: IdColumn<RecoveryCodeId>;
  set_id: IdColumn<RecoveryCodeSetId>;
  code_hash: string;
  used_at: Date | null;
}

export interface InvitesTable {
  id: IdColumn<UserInviteId>;
  workspace_id: IdColumn<WorkspaceId>;
  email: string;
  names: string;
  first_surname: string;
  second_surname: string;
  branch_id: IdColumn<BranchId>;
  team_id: NullableIdColumn<TeamId>;
  role_id: IdColumn<RoleId>;
  executive_category: ExecutiveCategory | null;
  token_hash: string;
  status: "pending" | "accepted" | "revoked";
  expires_at: Date;
  created_by_account_id: IdColumn<UserId>;
  accepted_account_id: NullableIdColumn<UserId>;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  last_delivered_at: Date | null;
}
