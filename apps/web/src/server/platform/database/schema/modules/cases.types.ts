import type { Generated } from "kysely";

import type { Json } from "~/contracts/json";
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
import type {
  CaseFieldKind,
  CaseStageTimeout,
} from "~/server/cases/domain/definition";
import type { CaseEventKind } from "~/server/cases/domain/events";

export interface CaseTypesTable {
  id: GeneratedId<CaseTypeId>;
  key: string;
  name: string;
  module: string | null;
  created_at: Date;
}

export interface CaseStagesTable {
  case_type_id: IdColumn<CaseTypeId>;
  key: string;
  name: string;
  position: number;
  owner_role: string;
  statuses: string[];
  initial_status: string;
  gate_stage_key: string | null;
  gate_statuses: string[] | null;
  branch_field: string | null;
  timeout: CaseStageTimeout | null;
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
  holder_user_id: IdColumn<UserId>;
  values: Record<string, string | number | null>;
  version: Generated<number>;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface CaseStageStatesTable {
  case_id: IdColumn<CaseId>;
  case_type_id: IdColumn<CaseTypeId>;
  stage_key: string;
  status: string;
  updated_by: NullableIdColumn<UserId>;
  updated_at: Date;
  due_at: Date | null;
}

export interface CaseEventsTable {
  id: Generated<string>;
  case_id: IdColumn<CaseId>;
  kind: CaseEventKind;
  action: string | null;
  detail: Json | null;
  stage_key: string | null;
  status: string | null;
  actor_user_id: NullableIdColumn<UserId>;
  subject_user_id: NullableIdColumn<UserId>;
  at: Date;
}
