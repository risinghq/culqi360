import type { ExecutiveCategory } from "~/domain/identity/executive-category";
import type { RoleId, TeamId } from "~/domain/ids";

export interface InviteInfo {
  fullName: string;
  username: string;
  email: string;
}

export interface CreateTeamInviteCommand {
  names: string;
  firstSurname: string;
  secondSurname: string;
  email: string;
  roleId: RoleId;
  executiveCategory: ExecutiveCategory | null;
  teamId: TeamId | null;
  expiresAt: Date | null;
}
