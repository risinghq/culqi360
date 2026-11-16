import { query } from "@solidjs/router";

import {
  getCase,
  listCases,
  listCaseTypes,
  listWaitingCases,
} from "~/server/cases/ui/queries";

export const caseTypesQuery = query(async () => {
  "use server";
  return listCaseTypes();
}, "cases.types");

export const casesQuery = query(async (caseTypeId: string) => {
  "use server";
  return listCases({ caseTypeId });
}, "cases.list");

export const waitingCasesQuery = query(async (caseTypeId: string) => {
  "use server";
  return listWaitingCases({ caseTypeId });
}, "cases.waiting");

export const caseQuery = query(async (caseId: string) => {
  "use server";
  return getCase({ caseId });
}, "cases.detail");
