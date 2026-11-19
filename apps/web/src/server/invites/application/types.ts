import type { RoleAssigner } from "~/domain/auth/access/member-management";
import type { Role } from "~/domain/auth/access/rbac";
import type { DomainError } from "~/domain/errors";
import type { ExecutiveCategory } from "~/domain/identity/executive-category";
import type {
  BranchId,
  RoleId,
  TeamId,
  UserId,
  UserInviteId,
  WorkspaceId,
} from "~/domain/ids";
import type { EventsWriter } from "~/server/event-logs/events-repo";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import type { RolesRepo } from "~/server/roles/repos-roles";
import type { AccountsRepo } from "~/server/users/repos-accounts";
import type { MembersRepo } from "~/server/users/repos-members";
import type { MembershipsRepo } from "~/server/users/repos-memberships";
import type { TeamsRepo } from "~/server/users/repos-teams";
import type { UserInvitesRepo } from "~/server/users/repos-user-invites";
import type { Result } from "~/shared/result";

// The member an invite drafts: who they are and where they go.
export interface InviteDraft {
  email: string;
  names: string;
  firstSurname: string;
  secondSurname: string;
  branchId: BranchId;
  teamId: TeamId | null;
  roleId: RoleId;
  executiveCategory: ExecutiveCategory | null;
}

export interface PendingInvite extends InviteDraft {
  inviteId: UserInviteId;
  expiresAt: Date;
  createdAt: Date;
  createdByUserId: UserId;
  lastDeliveredAt: Date | null;
}

export interface IssuedInvite {
  inviteId: UserInviteId;
  token: string;
  expiresAt: Date;
}

// The platform store's side of an invite, as the workspace app sees it. Every
// call names the workspace and passes plain data, so a store stub can serve it.
export interface InvitePlatformPort {
  issue(
    workspaceId: WorkspaceId,
    input: InviteDraft & { createdByUserId: UserId; expiresAt: Date },
    issuedAt: Date,
  ): Promise<IssuedInvite>;
  listPending(
    workspaceId: WorkspaceId,
    branchId: BranchId,
    activeAsOf: Date,
  ): Promise<PendingInvite[]>;
  findPending(
    workspaceId: WorkspaceId,
    inviteId: UserInviteId,
    activeAsOf: Date,
  ): Promise<PendingInvite | null>;
  findPendingByEmail(
    workspaceId: WorkspaceId,
    email: string,
    activeAsOf: Date,
  ): Promise<PendingInvite | null>;
  // Returns the new token, or null when the invite is no longer pending.
  rotate(
    workspaceId: WorkspaceId,
    inviteId: UserInviteId,
    expiresAt: Date,
  ): Promise<string | null>;
  revoke(
    workspaceId: WorkspaceId,
    inviteId: UserInviteId,
    revokedAt: Date,
  ): Promise<boolean>;
  markDelivered(
    workspaceId: WorkspaceId,
    inviteId: UserInviteId,
    deliveredAt: Date,
  ): Promise<void>;
}

export interface PlaceMemberInput extends InviteDraft {
  inviteId: UserInviteId;
  userId: UserId;
  username: string;
  avatarStorageKey: string | null;
  avatarVersion: number;
}

// The workspace store's side of an acceptance, as the platform app sees it.
export interface MemberPlacementPort {
  placeMember(
    workspaceId: WorkspaceId,
    input: PlaceMemberInput,
    placedAt: Date,
  ): Promise<Result<{ role: Role }, DomainError>>;
}

export interface WorkspaceInviteRepos {
  roles: Pick<RolesRepo, "findById">;
  teams: Pick<TeamsRepo, "findById">;
  members: Pick<MembersRepo, "hasActiveWithEmail" | "upsertActive">;
}

export interface WorkspaceInviteTransactionRepos extends WorkspaceInviteRepos {
  events: EventsWriter;
}

export interface WorkspaceInviteDeps {
  workspaceId: WorkspaceId;
  inviteTtlMs: number;
  repos: WorkspaceInviteRepos;
  uow: AppUow<WorkspaceInviteTransactionRepos>;
  platform: InvitePlatformPort;
}

export interface PendingBranchInvite {
  inviteId: UserInviteId;
  email: string;
  names: string;
  firstSurname: string;
  secondSurname: string;
  role: Role;
  roleName: string;
  teamId: TeamId | null;
  expiresAt: Date;
  createdAt: Date;
  createdByUserId: UserId;
  lastDeliveredAt: Date | null;
}

export interface CreateInviteInput {
  actorUserId: UserId;
  actor: RoleAssigner;
  branchId: BranchId;
  names: string;
  firstSurname: string;
  secondSurname: string;
  email: string;
  roleId: RoleId;
  executiveCategory?: ExecutiveCategory | null;
  teamId: TeamId | null;
  expiresAt?: Date | null;
}

export interface ManageInviteInput {
  actorUserId: UserId;
  actor: RoleAssigner;
  branchId: BranchId;
  inviteId: UserInviteId;
}

// What the invite email needs besides the link.
export interface InviteIssueResult extends IssuedInvite {
  email: string;
  fullName: { names: string; firstSurname: string; secondSurname: string };
  roleName: string;
}

// Runs in the workspace app, for a manager of that workspace.
export interface WorkspaceInviteService {
  listPendingInvites(
    branchId: BranchId,
    operation: OperationContext,
  ): Promise<PendingBranchInvite[]>;
  createInvite(
    input: CreateInviteInput,
    operation: OperationContext,
  ): Promise<Result<InviteIssueResult, DomainError>>;
  // Issues a new link for a pending invite; the previous link stops working.
  renewInvite(
    input: ManageInviteInput,
    operation: OperationContext,
  ): Promise<Result<InviteIssueResult, DomainError>>;
  revokeInvite(
    input: ManageInviteInput,
    operation: OperationContext,
  ): Promise<Result<void, DomainError>>;
  markInviteDelivered(
    inviteId: UserInviteId,
    operation: OperationContext,
  ): Promise<void>;
  placeMember(
    input: PlaceMemberInput,
    placedAt: Date,
  ): Promise<Result<{ role: Role }, DomainError>>;
}

export interface AcceptInvitePlatformRepos {
  invites: Pick<UserInvitesRepo, "findPendingByTokenHash" | "markAccepted">;
  accounts: Pick<AccountsRepo, "findByEmail" | "isUsernameTaken" | "create">;
  memberships: Pick<MembershipsRepo, "add">;
}

export interface AcceptInviteDeps {
  repos: AcceptInvitePlatformRepos;
  uow: AppUow<AcceptInvitePlatformRepos>;
  workspaces: MemberPlacementPort;
  hashPassword(password: string): Promise<string>;
  verifyPassword(passwordHash: string, password: string): Promise<boolean>;
}

export interface AcceptInviteInput {
  token: string;
  password: string;
}

export interface InviteAcceptedResult {
  accountId: UserId;
  workspaceId: WorkspaceId;
  role: Role;
}

// What the acceptance page shows before the person sets or enters a password.
export interface PendingInviteInfo {
  fullName: string;
  email: string;
  username: string;
  hasAccount: boolean;
}

// Runs in the platform app, for an anonymous request holding the link.
export interface InviteAcceptanceService {
  findInviteInfo: (
    token: string,
    operation: OperationContext,
  ) => Promise<PendingInviteInfo | null>;
  acceptInvite: (
    input: AcceptInviteInput,
    operation: OperationContext,
  ) => Promise<Result<InviteAcceptedResult, DomainError>>;
}
