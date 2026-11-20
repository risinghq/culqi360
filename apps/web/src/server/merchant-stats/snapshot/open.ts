import { GpvSnapshotId, type UserId } from "~/domain/ids";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";

export type OpenGpvImportResult =
  | { kind: "opened"; snapshotId: GpvSnapshotId }
  | { kind: "duplicate"; snapshotId: GpvSnapshotId }
  | { kind: "stale"; activeCutAt: Date };

// One import stages at a time. Opening a new one drops any snapshot still
// staging: its browser stopped sending batches, and its rows are incomplete.
export async function openGpvImport(
  db: WorkspaceExecutor,
  input: {
    contentSha256: string;
    cutAt: Date;
    uploadedBy: UserId;
    uploadedAt: Date;
  },
): Promise<OpenGpvImportResult> {
  return db.transaction().execute(async (tx) => {
    await tx
      .deleteFrom("gpv_snapshots")
      .where("state", "=", "staging")
      .execute();

    const duplicate = await tx
      .selectFrom("gpv_snapshots")
      .select("id")
      .where("content_sha256", "=", input.contentSha256)
      .executeTakeFirst();
    if (duplicate) {
      return { kind: "duplicate", snapshotId: duplicate.id };
    }

    const active = await tx
      .selectFrom("gpv_snapshots")
      .select("cut_at")
      .where("state", "=", "active")
      .executeTakeFirst();
    if (active && input.cutAt < active.cut_at) {
      return { kind: "stale", activeCutAt: active.cut_at };
    }

    const latest = await tx
      .selectFrom("gpv_snapshots")
      .select((eb) => eb.fn.max<number>("revision").as("revision"))
      .where("cut_at", "=", input.cutAt)
      .executeTakeFirst();
    const snapshot = await tx
      .insertInto("gpv_snapshots")
      .values({
        id: GpvSnapshotId.mint(),
        content_sha256: input.contentSha256,
        cut_at: input.cutAt,
        revision: (latest?.revision ?? 0) + 1,
        uploaded_by: input.uploadedBy,
        uploaded_at: input.uploadedAt,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return { kind: "opened", snapshotId: snapshot.id };
  });
}
