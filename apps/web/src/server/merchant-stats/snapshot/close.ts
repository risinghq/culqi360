import type { Insertable, Transaction } from "kysely";

import { fail, type DomainError } from "~/domain/errors";
import { type GpvSnapshotId, GpvSnapshotIssueId } from "~/domain/ids";
import type { GpvSnapshotState } from "~/domain/merchant-stats/snapshot";
import { insertBatches } from "~/server/platform/database/batches";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { WorkspaceDatabase } from "~/server/platform/database/types";
import { Err, Ok, type Result } from "~/shared/result";

import { activateGpvSnapshotInTransaction } from "./activate";

type IssueInsert = Insertable<WorkspaceDatabase["gpv_snapshot_issues"]>;

interface CloseGpvImportInput {
  snapshotId: GpvSnapshotId;
  closedAt: Date;
}

type CloseGpvImportResult = Result<{ state: GpvSnapshotState }, DomainError>;

/** Ends staging once the browser has sent every batch: flags the active
 * snapshot's placements the file left out, then settles the snapshot and
 * activates it when nothing blocks. Closing a settled snapshot reports its
 * state. */
export async function closeGpvImport(
  db: WorkspaceExecutor,
  input: CloseGpvImportInput,
): Promise<CloseGpvImportResult> {
  return db
    .transaction()
    .execute(async (tx) => closeGpvImportInTransaction(tx, input));
}

export async function closeGpvImportInTransaction(
  tx: Transaction<WorkspaceDatabase>,
  input: CloseGpvImportInput,
): Promise<CloseGpvImportResult> {
  const snapshot = await tx
    .selectFrom("gpv_snapshots")
    .select(["state", "uploaded_by"])
    .where("id", "=", input.snapshotId)
    .executeTakeFirst();
  if (!snapshot) {
    return Err(fail("gpv_snapshot_not_found"));
  }
  if (snapshot.state !== "staging") {
    return Ok({ state: snapshot.state });
  }

  const missing = await missingPlacementIssues(
    tx,
    input.snapshotId,
    input.closedAt,
  );
  for (const chunk of insertBatches(missing)) {
    // eslint-disable-next-line no-await-in-loop
    await tx.insertInto("gpv_snapshot_issues").values(chunk).execute();
  }

  const state = await settleGpvSnapshot(tx, input.snapshotId);
  if (state === "needs_review") {
    return Ok({ state });
  }
  const activated = await activateGpvSnapshotInTransaction(tx, {
    snapshotId: input.snapshotId,
    activatedBy: snapshot.uploaded_by,
    activatedAt: input.closedAt,
  });
  return activated.ok ? Ok({ state: "active" as const }) : activated;
}

/** Sets a snapshot to needs_review while a blocking issue is open, and to
 * ready otherwise. */
export async function settleGpvSnapshot(
  tx: Transaction<WorkspaceDatabase>,
  snapshotId: GpvSnapshotId,
): Promise<"needs_review" | "ready"> {
  const open = await tx
    .selectFrom("gpv_snapshot_issues")
    .select("id")
    .where("snapshot_id", "=", snapshotId)
    .where("severity", "=", "blocking")
    .where("status", "=", "open")
    .limit(1)
    .executeTakeFirst();
  const state = open ? "needs_review" : "ready";
  await tx
    .updateTable("gpv_snapshots")
    .set({ state })
    .where("id", "=", snapshotId)
    .execute();
  return state;
}

async function missingPlacementIssues(
  tx: Transaction<WorkspaceDatabase>,
  snapshotId: GpvSnapshotId,
  createdAt: Date,
): Promise<IssueInsert[]> {
  const active = await tx
    .selectFrom("gpv_snapshots")
    .select("id")
    .where("state", "=", "active")
    .executeTakeFirst();
  if (!active) {
    return [];
  }
  const missing = await tx
    .selectFrom("gpv_snapshot_placements as previous")
    .leftJoin("gpv_snapshot_placements as candidate", (join) =>
      join
        .on("candidate.snapshot_id", "=", snapshotId)
        .onRef("candidate.placement_key", "=", "previous.placement_key"),
    )
    .select(["previous.placement_key", "previous.ruc", "previous.sale_month"])
    .where("previous.snapshot_id", "=", active.id)
    .where("candidate.id", "is", null)
    .execute();

  return missing.map((placement) => ({
    id: GpvSnapshotIssueId.mint(),
    snapshot_id: snapshotId,
    issue_key: `missing:${placement.placement_key}`,
    issue_type: "placement_missing",
    entity_key: placement.placement_key,
    severity: "blocking",
    detail: "La colocación estaba en el corte anterior y falta en el nuevo.",
    previous_value: JSON.stringify(placement),
    candidate_value: null,
    created_at: createdAt,
  }));
}
