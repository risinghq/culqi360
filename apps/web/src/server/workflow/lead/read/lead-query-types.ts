import type {
  MembersTable,
  OrganizationCurrentOwnersView,
  OrganizationsTable,
  WorkflowLeadsTable,
  WorkspaceDatabase,
} from "~/server/platform/database/types";

export interface LeadAlias {
  lead: WorkflowLeadsTable;
}

export interface ExecutiveAlias {
  executive: MembersTable;
}

export interface OwnerAlias {
  owner: OrganizationCurrentOwnersView;
}

export interface CreatorAlias {
  creator: MembersTable;
}

export interface OrganizationAlias {
  org: OrganizationsTable;
}

export type LeadQueryDatabase = WorkspaceDatabase &
  LeadAlias &
  OwnerAlias &
  ExecutiveAlias &
  CreatorAlias &
  OrganizationAlias;
