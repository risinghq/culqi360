import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  INSTALLATION_WORKSPACE_ID,
  openSeedTarget,
  seedIfEmpty,
} from "~/server/platform/database/seed";

import { sourceFingerprint } from "../support/source-fingerprint";
import { mintAllSessions, type PreviewStores } from "./roster";

// Its own directory, so this tool never touches the development data.
export const PREVIEW_DATA_DIR = resolve(process.cwd(), ".preview-data");

const FINGERPRINT_FILE = join(PREVIEW_DATA_DIR, "fingerprint");

// Only schema and seed changes require rebuilding the preview data.
const FINGERPRINT_ROOTS = [
  "src/server/platform/database/schema",
  "src/server/platform/database/seeds",
];

function isUpToDate(): boolean {
  return (
    existsSync(FINGERPRINT_FILE) &&
    readFileSync(FINGERPRINT_FILE, "utf8") ===
      sourceFingerprint(FINGERPRINT_ROOTS)
  );
}

export async function openPreviewStores(): Promise<PreviewStores> {
  const target = await openSeedTarget(PREVIEW_DATA_DIR);
  return {
    platform: target.platform,
    workspaceId: INSTALLATION_WORKSPACE_ID,
    workspace: await target.workspace(INSTALLATION_WORKSPACE_ID),
  };
}

async function rebuild(): Promise<void> {
  console.log("[preview] rebuilding .preview-data...");

  rmSync(PREVIEW_DATA_DIR, { recursive: true, force: true });

  await seedIfEmpty(await openSeedTarget(PREVIEW_DATA_DIR));
  const minted = await mintAllSessions(await openPreviewStores(), new Date());

  console.log(`[preview] seeded, minted sessions for ${minted} members`);

  writeFileSync(FINGERPRINT_FILE, sourceFingerprint(FINGERPRINT_ROOTS));
}

// Returns true when callers need to restart against the rebuilt data.
export async function ensureData(options: {
  fresh: boolean;
}): Promise<boolean> {
  if (!options.fresh && isUpToDate()) {
    return false;
  }

  await rebuild();

  return true;
}
