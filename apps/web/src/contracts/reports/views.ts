import type { ActivityChannelView } from "~/contracts/activities/views";

export type ReportReachView = "own" | "branch" | "all";

export type ReportCaseTypeView = {
  id: string;
  name: string;
  stages: { key: string; name: string }[];
  numberFields: { key: string; label: string }[];
};

export type ReportFiltersView = {
  reach: ReportReachView;
  caseTypes: ReportCaseTypeView[];
  users: { id: string; name: string }[];
  outcomes: { id: string; label: string; channel: ActivityChannelView }[];
};

export type ProductionQueryView = {
  caseTypeId: string;
  stageKey: string;
  sumFieldKey: string | null;
  month: string;
};

export type ProductionReportView = {
  statuses: string[];
  rows: {
    holderUserId: string;
    holderName: string;
    counts: number[];
    total: number;
    sum: number | null;
  }[];
  totals: { counts: number[]; total: number; sum: number | null };
  sumLabel: string | null;
};

export type ActivityQueryView = {
  from: string;
  to: string;
  userId: string | null;
  channel: ActivityChannelView | null;
  outcomeId: string | null;
};

export type ActivityRowView = {
  startedAt: number;
  channel: ActivityChannelView;
  userName: string;
  ruc: string;
  legalName: string | null;
  contactName: string | null;
  subject: string | null;
  outcomeLabel: string | null;
  durationSeconds: number | null;
};
