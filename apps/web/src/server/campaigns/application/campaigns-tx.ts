import type { Transaction } from "kysely";

import { createOrganizationRepo } from "~/server/organization/organization-repo";
import type { Database } from "~/server/platform/database/types";

import { createCampaignsRepo } from "../infrastructure/campaigns-repo";

export function bindCampaignsTx(tx: Transaction<Database>) {
  return {
    campaigns: createCampaignsRepo(tx),
    organizations: createOrganizationRepo(tx),
  };
}

export type CampaignsTx = ReturnType<typeof bindCampaignsTx>;
