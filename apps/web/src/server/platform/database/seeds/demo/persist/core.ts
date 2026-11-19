import type { SeedStores } from "../../shared/people";
import type { CompiledWorkflowScenario } from "../compiler";
import { persistCompanyRegistryRecords } from "./company-registry-records";
import { persistWorkflowFulfillment } from "./fulfillment";
import { persistWorkflowHistoryEvents } from "./history-events";
import { persistOrganizations } from "./organizations";
import { persistWorkflowCommercialData } from "./workflow-commercial";
import { persistWorkflowLeadsAndAssignments } from "./workflow-leads";

export async function persistWorkflowSample(
  stores: SeedStores,
  compiled: CompiledWorkflowScenario,
): Promise<void> {
  const db = stores.workspace;
  const anchorMs = compiled.generatedAtMs;
  const day = compiled.dayMs;
  const overlayTtl = compiled.overlayTtlMs;
  const { leads } = compiled;

  const orgIdByRuc = await persistOrganizations(db, leads, new Date(anchorMs));
  await persistWorkflowLeadsAndAssignments(
    db,
    anchorMs,
    day,
    orgIdByRuc,
    leads,
  );
  await persistCompanyRegistryRecords(
    stores.registry,
    anchorMs,
    day,
    overlayTtl,
    leads,
  );
  await persistWorkflowCommercialData(db, anchorMs, day, orgIdByRuc, leads);
  // Needs the venues created above (units reference them).
  await persistWorkflowFulfillment(db, anchorMs, day, leads);
  await persistWorkflowHistoryEvents(db, anchorMs, day, leads);
}
