import { rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { randomUUIDv7 } from "bun";

import { WorkspaceId } from "~/domain/ids";
import { databaseConfig } from "~/server/platform/config/env";
import { fileStores } from "~/server/platform/database/bun-store";
import {
  openPlatformStore,
  openWorkspaceStore,
} from "~/server/platform/database/open-store";
import { workspaceStoreName } from "~/server/platform/database/store";

import { loadCutover } from "./load";
import type { CutoverPlan } from "./plan";

// Prints counts and source ids only: the rows hold third-party personal data.
function printReport(plan: CutoverPlan): void {
  const counts = Object.fromEntries(
    Object.entries(plan).flatMap(([key, value]) =>
      Array.isArray(value) ? [[key, value.length]] : [],
    ),
  );
  const skipped = new Map<string, string[]>();
  for (const row of plan.report.skipped) {
    const key = `${row.table} ${row.reason}`;
    const ids = skipped.get(key) ?? [];
    ids.push(row.sourceId);
    skipped.set(key, ids);
  }
  console.log(JSON.stringify({ counts }, null, 2));
  for (const [key, ids] of skipped) {
    const shown = ids.slice(0, 20).join(", ");
    console.log(
      `skipped ${key}: ${ids.length} (${shown}${ids.length > 20 ? ", …" : ""})`,
    );
  }
  for (const [key, count] of Object.entries(plan.report.warnings)) {
    console.log(`warning ${key}: ${count}`);
  }
}

// The command line of a one-time cutover: a dry run prints the report, and
// --write creates the workspace in the local stores.
export async function runCutover(options: {
  defaultName: string;
  plan: (input: { newId: () => string; at: Date }) => Promise<CutoverPlan>;
}): Promise<void> {
  const { values } = parseArgs({
    options: {
      workspace: { type: "string", default: options.defaultName },
      write: { type: "boolean", default: false },
    },
  });
  const at = new Date();
  const plan = await options.plan({ newId: randomUUIDv7, at });
  printReport(plan);
  if (!values.write) {
    console.log("Dry run. Pass --write to create the workspace.");
    return;
  }
  const workspaceId = WorkspaceId.trust(randomUUIDv7());
  const { dataDir } = databaseConfig();
  const openStore = fileStores(dataDir);
  const storeName = workspaceStoreName(workspaceId);
  const { db: platform } = await openPlatformStore(openStore("platform"));
  const { db: workspace } = await openWorkspaceStore(openStore(storeName));
  let loaded = false;
  try {
    await loadCutover(
      { platform, workspace },
      { plan, workspaceId, workspaceName: values.workspace, at },
    );
    loaded = true;
  } finally {
    await workspace.destroy();
    await platform.destroy();
    // stores:push would send a failed run's store as a new workspace.
    if (!loaded) {
      for (const suffix of ["", "-wal", "-shm"]) {
        rmSync(join(dataDir, `${storeName}.sqlite${suffix}`), { force: true });
      }
    }
  }
  console.log(`Created workspace ${values.workspace} (${workspaceId}).`);
}
