import type { Generated } from "kysely";

import type {
  ContactId,
  GeneratedId,
  IdColumn,
  OrganizationId,
  OrganizationOwnershipId,
  PersonId,
  UserId,
} from "~/domain/ids";

export interface PeopleTable {
  id: GeneratedId<PersonId>;
  dni: string;
  names: string;
  first_surname: string | null;
  second_surname: string | null;
  email: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrganizationsTable {
  id: GeneratedId<OrganizationId>;
  ruc: string;
  legal_name: string | null;
  line_of_business: string | null;
  address: string | null;
  district: string | null;
  province: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  created_at: Date;
}

export interface OrganizationOwnershipsTable {
  id: GeneratedId<OrganizationOwnershipId>;
  organization_id: IdColumn<OrganizationId>;
  executive_id: IdColumn<UserId>;
  valid_from: Date;
  valid_until: Date | null;
  assigned_by: IdColumn<UserId>;
  reason: string | null;
  created_at: Date;
}

export interface OrganizationCurrentOwnersView {
  organization_id: IdColumn<OrganizationId>;
  executive_id: IdColumn<UserId>;
  assigned_at: Date;
}

export interface ContactsTable {
  id: GeneratedId<ContactId>;
  person_id: IdColumn<PersonId>;
  organization_id: IdColumn<OrganizationId>;
  phone: string | null;
  email: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ContactRolesTable {
  id: Generated<string>;
  contact_id: IdColumn<ContactId>;
  role: string;
  is_primary: boolean;
  effective_from: Date;
  effective_to: Date | null;
}
