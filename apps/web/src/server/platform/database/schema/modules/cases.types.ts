import type { Generated } from "kysely";

import type { Role } from "~/domain/auth/access/rbac";
import type {
  CaseFieldCondition,
  CaseNumberBounds,
} from "~/domain/cases/field-rules";
import type {
  CaseId,
  CaseTypeId,
  GeneratedId,
  IdColumn,
  NullableIdColumn,
  OrganizationId,
  UserId,
} from "~/domain/ids";
import type { CaseFieldKind } from "~/server/cases/domain/definition";

export interface CaseTypesTable {
  id: GeneratedId<CaseTypeId>;
  key: string;
  name: string;
  created_at: Date;
}

export interface CaseStagesTable {
  case_type_id: IdColumn<CaseTypeId>;
  key: string;
  name: string;
  position: number;
  owner_role: Role;
  statuses: string[];
  initial_status: string;
  gate_stage_key: string | null;
  gate_statuses: string[] | null;
}

export interface CaseFieldsTable {
  case_type_id: IdColumn<CaseTypeId>;
  stage_key: string;
  key: string;
  label: string;
  kind: CaseFieldKind;
  choices: string[] | null;
  required: boolean;
  required_when: CaseFieldCondition | null;
  bounds: CaseNumberBounds | null;
  amendable_while: { stageKey: string; statuses: string[] } | null;
  corrected_by: string[];
  position: number;
}

export interface CasesTable {
  id: GeneratedId<CaseId>;
  case_type_id: IdColumn<CaseTypeId>;
  organization_id: IdColumn<OrganizationId>;
  owner_user_id: IdColumn<UserId>;
  values: Record<string, string | number | null>;
  version: Generated<number>;
  created_at: Date;
  updated_at: Date;
}

export interface CaseStageStatesTable {
  case_id: IdColumn<CaseId>;
  case_type_id: IdColumn<CaseTypeId>;
  stage_key: string;
  status: string;
  updated_by: NullableIdColumn<UserId>;
  updated_at: Date;
}
