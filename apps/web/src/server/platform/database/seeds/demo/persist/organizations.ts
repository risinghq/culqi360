import type { Kysely } from "kysely";

import { OrganizationId } from "~/domain/ids";
import { insertBatches } from "~/server/platform/database/batches";

import type { WorkspaceDatabase } from "../../../types";
import { stableSeedId } from "../../shared/stable-id";
import type { CompiledLead } from "../compiler";

export type OrganizationsByRuc = Map<string, OrganizationId>;

export async function persistOrganizations(
  db: Kysely<WorkspaceDatabase>,
  leads: readonly CompiledLead[],
  seededAt: Date,
): Promise<OrganizationsByRuc> {
  const rows = leads.map(({ spec }) => ({
    id: OrganizationId.trust(stableSeedId(`organization:${spec.key}`)),
    ruc: spec.org.ruc,
    legal_name: spec.org.legalName,
    line_of_business: spec.org.lineOfBusiness,
    address: spec.org.address,
    district: spec.org.district,
    province: spec.org.province,
    department: spec.org.department,
    created_at: seededAt,
  }));

  for (const batch of insertBatches(rows)) {
    // eslint-disable-next-line no-await-in-loop
    await db.insertInto("organizations").values(batch).execute();
  }

  return new Map(rows.map((row) => [row.ruc, row.id]));
}
