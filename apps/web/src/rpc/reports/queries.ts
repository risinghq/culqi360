import { query } from "@solidjs/router";

import type {
  ActivityQueryView,
  ProductionQueryView,
} from "~/contracts/reports/views";
import {
  getActivityReport,
  getProductionReport,
  getReportFilters,
} from "~/server/reports/ui/functions";

export const reportFiltersQuery = query(async () => {
  "use server";
  return getReportFilters();
}, "reports.filters");

export const productionReportQuery = query(
  async (input: ProductionQueryView) => {
    "use server";
    return getProductionReport(input);
  },
  "reports.production",
);

export const activityReportQuery = query(async (input: ActivityQueryView) => {
  "use server";
  return getActivityReport(input);
}, "reports.activity");
