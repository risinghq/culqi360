import { parseArgs } from "node:util";

import { randomUUIDv7, SQL } from "bun";

import { WorkspaceId } from "~/domain/ids";
import { db } from "~/server/platform/database/db";

import { loadSafeappCutover } from "./load";
import { readSafeappSnapshot } from "./source";
import { planSafeappCutover, type CutoverPlan } from "./transform";

// Prints counts and source ids only: the rows hold third-party personal data.
function printReport(plan: CutoverPlan): void {
  const counts = {
    branches: plan.branches.length,
    users: plan.users.length,
    organizations: plan.organizations.length,
    caseTypes: plan.caseTypes.length,
    cases: plan.cases.length,
    campaigns: plan.campaigns.length,
    campaignRecords: plan.campaignRecords.length,
    campaignAssignments: plan.campaignAssignments.length,
    calls: plan.calls.length,
  };
  const skipped = new Map<string, string[]>();
  for (const row of plan.report.skipped) {
    const key = `${row.table} ${row.reason}`;
    const ids = skipped.get(key) ?? [];
    ids.push(row.sourceId);
    skipped.set(key, ids);
  }
  console.log(JSON.stringify({ counts }, null, 2));
  for (const [key, ids] of skipped) {
    console.log(`skipped ${key}: ${ids.length} (${ids.join(", ")})`);
  }
  for (const [key, count] of Object.entries(plan.report.warnings)) {
    console.log(`warning ${key}: ${count}`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      workspace: { type: "string", default: "Entel" },
      write: { type: "boolean", default: false },
    },
  });
  const sourceUrl = process.env.SAFEAPP_DATABASE_URL;
  if (!sourceUrl) {
    throw new Error("SAFEAPP_DATABASE_URL is not set");
  }
  const source = new SQL(sourceUrl);
  const at = new Date();
  try {
    const snapshot = await readSafeappSnapshot(source);
    const plan = planSafeappCutover({ snapshot, newId: randomUUIDv7, at });
    printReport(plan);
    if (!values.write) {
      console.log("Dry run. Pass --write to create the workspace.");
      return;
    }
    const workspaceId = WorkspaceId.trust(randomUUIDv7());
    await loadSafeappCutover(db, {
      plan,
      workspaceId,
      workspaceName: values.workspace,
      at,
    });
    console.log(`Created workspace ${values.workspace} (${workspaceId}).`);
  } finally {
    await source.close();
    await db.destroy();
  }
}

await main();
