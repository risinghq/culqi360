import type { Ruc } from "~/domain/identity/document";
import type {
  ActivityId,
  ActivityOutcomeId,
  BranchId,
  CampaignId,
  CampaignRecordId,
  OrganizationId,
  TeamId,
  UserId,
} from "~/domain/ids";
import type { OutcomeSeed } from "~/server/activities/domain/outcome-seed";
import type { CaseTypeDefinition } from "~/server/cases/domain/definition";
import type { ImportedCase } from "~/server/cases/infrastructure/cases-repo";
import type { ActivityChannel } from "~/server/platform/database/types";
import type { RoleSeed } from "~/server/roles/create-workspace";

import type { SkippedRow } from "./rows";

export type CutoverBranch = { id: BranchId; name: string };

export type CutoverTeam = { id: TeamId; branchId: BranchId; name: string };

export type CutoverUser = {
  id: UserId;
  branchId: BranchId;
  teamId: TeamId | null;
  username: string;
  email: string;
  names: string;
  firstSurname: string;
  secondSurname: string;
  // A baseline role key or the key of one of the plan's roles.
  roleKey: string;
  isActive: boolean;
};

export type CutoverOrganization = {
  id: OrganizationId;
  ruc: Ruc;
  legalName: string | null;
  district: string | null;
  phone: string | null;
};

export type CutoverCampaign = { id: CampaignId; name: string };

export type CutoverCampaignRecord = {
  id: CampaignRecordId;
  campaignId: CampaignId;
  organizationId: OrganizationId;
  segment: string;
  facts: Record<string, string>;
  workedAt: Date | null;
};

export type CutoverCampaignHold = {
  recordId: CampaignRecordId;
  userId: UserId;
  heldAt: Date;
  releasedAt: Date | null;
};

export type CutoverOutcome = OutcomeSeed & { id: ActivityOutcomeId };

export type CutoverActivity = {
  id: ActivityId;
  channel: ActivityChannel;
  userId: UserId;
  branchId: BranchId;
  organizationId: OrganizationId;
  campaignRecordId: CampaignRecordId | null;
  phone: string | null;
  startedAt: Date;
  outcomeId: ActivityOutcomeId | null;
  notes: string | null;
};

// Counts, never values: the report is printed, and the rows hold third-party
// personal data.
export type CutoverReport = {
  skipped: SkippedRow[];
  warnings: Record<string, number>;
};

// One source system mapped onto one new workspace.
export type CutoverPlan = {
  roles: readonly RoleSeed[];
  branches: CutoverBranch[];
  teams: CutoverTeam[];
  users: CutoverUser[];
  organizations: CutoverOrganization[];
  caseTypes: CaseTypeDefinition[];
  cases: (ImportedCase & { caseTypeKey: string })[];
  campaigns: CutoverCampaign[];
  campaignRecords: CutoverCampaignRecord[];
  campaignHolds: CutoverCampaignHold[];
  outcomes: CutoverOutcome[];
  activities: CutoverActivity[];
  report: CutoverReport;
};
