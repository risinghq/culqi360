import { action } from "@solidjs/router";

import type {
  ActivityQueryView,
  ProductionQueryView,
} from "~/contracts/reports/views";
import {
  exportActivityReport,
  exportProductionReport,
} from "~/rpc/reports/actions";

export const exportProductionMutation = action(
  async (query: ProductionQueryView) => exportProductionReport(query),
  "exportProductionReport",
);

export const exportActivityMutation = action(
  async (query: ActivityQueryView) => exportActivityReport(query),
  "exportActivityReport",
);
