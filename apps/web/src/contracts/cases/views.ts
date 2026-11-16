export type CaseFieldKindView = "text" | "number" | "date" | "choice";

export type CaseFieldView = {
  key: string;
  label: string;
  kind: CaseFieldKindView;
  choices: string[] | null;
  required: boolean;
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
  opening: { name: string; fields: CaseFieldView[] };
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

// writable: the viewer may save the stage now. The other values say why not.
export type CaseStageAccessView =
  | "writable"
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
  // The stage's own fields, then the earlier ones it may correct.
  editableFields: CaseFieldView[];
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
