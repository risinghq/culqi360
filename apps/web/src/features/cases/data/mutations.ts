import { action } from "@solidjs/router";
import { respond } from "@solidjs/web";

import type { CaseDetailView } from "~/contracts/cases/views";
import {
  openCase,
  reassignCase,
  requestCaseFileToken,
  requestCaseReport,
  uploadCaseFile,
  writeCaseStage,
} from "~/rpc/cases/actions";
import { caseQuery, casesQuery, waitingCasesQuery } from "~/rpc/cases/queries";

type CaseValuesInput = CaseDetailView["values"];

export const openCaseMutation = action(
  async (input: {
    caseTypeKey: string;
    ruc: string;
    values: CaseValuesInput;
  }) =>
    respond(await openCase(input), {
      revalidate: [casesQuery.key, waitingCasesQuery.key],
    }),
  "openCase",
);

export const writeCaseStageMutation = action(
  async (input: {
    caseId: string;
    expectedVersion: number;
    stageKey: string;
    status: string;
    values: CaseValuesInput;
  }) =>
    respond(await writeCaseStage(input), {
      revalidate: [caseQuery.key, casesQuery.key, waitingCasesQuery.key],
    }),
  "writeCaseStage",
);

export const requestCaseReportMutation = action(
  async (caseTypeId: string) => requestCaseReport({ caseTypeId }),
  "requestCaseReport",
);

export const reassignCaseMutation = action(
  async (input: {
    caseId: string;
    expectedVersion: number;
    holderUserId: string;
  }) =>
    respond(await reassignCase(input), {
      revalidate: [caseQuery.key, casesQuery.key],
    }),
  "reassignCase",
);

// The upload holds no case until a stage save stores its id.
export const uploadCaseFileMutation = action(async (file: File) => {
  const formData = new FormData();
  formData.append("file", file);
  return uploadCaseFile(formData);
}, "uploadCaseFile");

export const requestCaseFileTokenMutation = action(
  async (input: { caseId: string; fieldKey: string }) =>
    requestCaseFileToken(input),
  "requestCaseFileToken",
);
