import type {
  CaseFieldCondition,
  CaseNumberBounds,
} from "~/domain/cases/field-rules";

export type CaseFieldKindView = "text" | "number" | "date" | "choice";

export type CaseFieldView = {
  key: string;
  stageKey: string;
  label: string;
  kind: CaseFieldKindView;
  choices: string[] | null;
  required: boolean;
  requiredWhen: CaseFieldCondition | null;
  bounds: CaseNumberBounds | null;
};

export type CaseTypeView = {
  id: string;
  key: string;
  name: string;
  // The viewer's role files new cases of this type.
  canOpen: boolean;
  // The viewer's role owns a stage that cases wait at.
  hasQueue: boolean;
  // The stage that files the case, with the fields it asks for.
  opening: {
    key: string;
    name: string;
    initialStatus: string;
    fields: CaseFieldView[];
  };
  stages: { key: string; name: string }[];
};

export type CaseSummaryView = {
  id: string;
  ruc: string;
  legalName: string | null;
  ownerName: string;
  statuses: Record<string, string>;
  updatedAt: number;
};

// writable: the viewer may save the stage now. amending: the stage is locked,
// but the viewer may still update some of its values. The other values say
// why not.
export type CaseStageAccessView =
  | "writable"
  | "amending"
  | "not_owned"
  | "not_open"
  | "locked";

export type CaseStageView = {
  key: string;
  name: string;
  ownerRoleLabel: string;
  status: string;
  statuses: string[];
  initialStatus: string;
  access: CaseStageAccessView;
  fields: CaseFieldView[];
  // The fields a save may set now: the stage's own, then the earlier ones it
  // corrects, or only the amendable ones while the stage is amended.
  editableFields: CaseFieldView[];
  // The stage needs its required fields filled even in its initial status.
  keepsRequired: boolean;
  lastAuthor: { name: string | null; at: number } | null;
};

export type CaseDetailView = {
  id: string;
  caseType: { key: string; name: string };
  organizationId: string;
  ruc: string;
  legalName: string | null;
  ownerName: string;
  version: number;
  values: Record<string, string | number | null>;
  createdAt: number;
  updatedAt: number;
  stages: CaseStageView[];
};
