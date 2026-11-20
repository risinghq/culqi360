import type { BookFilter } from "~/contracts/merchant-stats/views";
import type { SheetFileView } from "~/contracts/sheets/views";
import type { DomainError } from "~/domain/errors";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import { Ok, type Result } from "~/shared/result";

import { getCohortRows } from "../read/cohort";
import { getActiveGpvSnapshotCut } from "../read/latest-report";
import { buildMerchantGpvSheet } from "./sheet";

// The file is dated by the active snapshot's cut, or by `at` before the first
// snapshot.
export async function exportMerchantGpv(
  db: WorkspaceExecutor,
  filter: BookFilter,
  at: Date,
): Promise<Result<SheetFileView, DomainError>> {
  const [rows, cutAt] = await Promise.all([
    getCohortRows(db, filter),
    getActiveGpvSnapshotCut(db),
  ]);
  return Ok(buildMerchantGpvSheet(rows, cutAt ?? at));
}
