import type {
  CaseFieldCondition,
  CaseNumberBounds,
} from "~/domain/cases/field-rules";

export type CaseFieldKindView =
  | "text"
  | "number"
  | "date"
  | "choice"
  | "branch"
  | "file";

export type CaseFieldOption = { value: string; label: string };

export type CaseFieldView = {
  key: string;
  stageKey: string;
  label: string;
  kind: CaseFieldKindView;
  // The values a choice or branch field can hold. A branch field stores the
  // branch id and shows its name.
  options: CaseFieldOption[] | null;
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
  holderName: string;
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
  | "other_branch"
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
  // A timeout or an unattributed import leaves a write with no author name.
  lastAuthor: { name: string | null; at: number } | null;
  // When the stage's timeout moves it on, while it waits in that status.
  dueAt: number | null;
};

export type CaseEventKindView =
  | "opened"
  | "stage_written"
  | "reassigned"
  | "timed_out";

export type CaseEventView = {
  kind: CaseEventKindView;
  stageName: string | null;
  status: string | null;
  actorName: string | null;
  holderName: string | null;
  at: number;
};

export type CaseDetailView = {
  id: string;
  caseType: { key: string; name: string };
  organizationId: string;
  ruc: string;
  legalName: string | null;
  holderName: string;
  holderUserId: string;
  version: number;
  values: Record<string, string | number | null>;
  // Display names of the files the file fields hold, by file id.
  fileNames: Record<string, string>;
  createdAt: number;
  updatedAt: number;
  stages: CaseStageView[];
  // Oldest first.
  events: CaseEventView[];
  // The users the viewer may hand the case to; empty when the viewer may not
  // reassign it.
  holderCandidates: { id: string; name: string }[];
};
