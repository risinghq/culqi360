import {
  requestActivityExport,
  requestProductionExport,
} from "~/server/reports/ui/functions";

export async function exportProductionReport(input: unknown) {
  "use server";
  return requestProductionExport(input);
}

export async function exportActivityReport(input: unknown) {
  "use server";
  return requestActivityExport(input);
}
