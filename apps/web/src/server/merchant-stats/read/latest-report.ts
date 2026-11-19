import type { WorkspaceExecutor } from "~/server/platform/database/executor";

export async function getActiveGpvSnapshotCut(
  db: WorkspaceExecutor,
): Promise<Date | null> {
  const snapshot = await db
    .selectFrom("gpv_snapshots")
    .where("state", "=", "active")
    .select("cut_at")
    .executeTakeFirst();

  return snapshot?.cut_at ?? null;
}
