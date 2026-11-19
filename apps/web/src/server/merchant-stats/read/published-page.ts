import type { Kysely } from "kysely";

import type { PublishedPage } from "~/contracts/merchant-stats/views";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { WorkspaceDatabase } from "~/server/platform/database/types";

// One transaction, so the rows belong to the publication it read.
export async function readPublishedGpvPage<Row>(
  db: Kysely<WorkspaceDatabase>,
  readRows: (transaction: WorkspaceExecutor) => Promise<Row[]>,
): Promise<PublishedPage<Row>> {
  return db.transaction().execute(async (transaction) => {
    const publication = await transaction
      .selectFrom("gpv_snapshots")
      .where("state", "=", "active")
      .select("id")
      .executeTakeFirst();

    if (!publication) {
      return { publicationId: null, rows: [] };
    }

    const rows = await readRows(transaction);
    return { publicationId: publication.id, rows };
  });
}
