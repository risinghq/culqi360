import { sql } from "kysely";

import { type GpvSnapshotId, OrganizationId } from "~/domain/ids";
import { insertBatches } from "~/server/platform/database/batches";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";

// Culqi's own export already carries enough to identify a merchant (RUC,
// legal name, address). A RUC with real GPV activity but no CRM record is
// not a data-quality exception to review one at a time (that stopped
// scaling once real data brought hundreds of RUCs CRM never registered) -
// it is the CRM lagging reality, so activation closes the gap directly.
// Ownership stays a human decision: this only creates the organization
// shell, never an owner assignment, so it keeps surfacing in the "no_owner"
// quality queue until someone assigns an executive.
export async function provisionOrganizationsFromSnapshot(
  tx: WorkspaceExecutor,
  input: { snapshotId: GpvSnapshotId; createdAt: Date },
): Promise<void> {
  const missing = await tx
    .selectFrom("gpv_snapshot_placements as placement")
    .leftJoin("organizations as org", "org.ruc", "placement.ruc")
    .where("placement.snapshot_id", "=", input.snapshotId)
    .where("org.id", "is", null)
    .groupBy("placement.ruc")
    .select((eb) => [
      "placement.ruc",
      eb.fn.max("placement.legal_name").as("legal_name"),
      sql<string | null>`max(${eb.ref("placement.raw")} ->> 'direccion')`.as(
        "address",
      ),
      sql<string | null>`max(${eb.ref("placement.raw")} ->> 'distrito')`.as(
        "district",
      ),
      sql<string | null>`max(${eb.ref("placement.raw")} ->> 'provincia')`.as(
        "province",
      ),
      sql<string | null>`max(${eb.ref("placement.raw")} ->> 'departamento')`.as(
        "department",
      ),
      sql<string | null>`max(${eb.ref("placement.raw")} ->> 'phone')`.as(
        "phone",
      ),
      sql<string | null>`max(${eb.ref("placement.raw")} ->> 'email')`.as(
        "email",
      ),
    ])
    .execute();

  const rows = missing.map((candidate) =>
    Object.assign(candidate, {
      id: OrganizationId.mint(),
      created_at: input.createdAt,
    }),
  );
  for (const batch of insertBatches(rows)) {
    // eslint-disable-next-line no-await-in-loop
    await tx.insertInto("organizations").values(batch).execute();
  }
}
