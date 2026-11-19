import type { RoleOption } from "~/domain/auth/access/member-management";
import type { Role } from "~/domain/auth/access/rbac";

export interface BulkImportSetup {
  assignableRoles: RoleOption[];
}

export interface TeamInvite {
  inviteId: string;
  names: string;
  firstSurname: string;
  secondSurname: string;
  email: string;
  role: Role;
  roleName: string;
  teamId: string | null;
  expiresAt: number;
  createdAt: number;
  lastDeliveredAt: number | null;
}

export interface TeamOption {
  id: string;
  name: string;
}

export interface InviteManagement {
  pendingInvites: TeamInvite[];
  teams: TeamOption[];
  assignableRoles: RoleOption[];
}

export interface CreateTeamInviteInput {
  names: string;
  firstSurname: string;
  secondSurname: string;
  email: string;
  roleId: string;
  executiveCategory: string | null;
  teamId: string | null;
  expiresOn: string | null;
}
