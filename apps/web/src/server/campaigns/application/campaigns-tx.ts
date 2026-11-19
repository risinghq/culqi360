import type { Transaction } from "kysely";

import { createActivitiesRepo } from "~/server/activities/infrastructure/activities-repo";
import { createOutcomesRepo } from "~/server/activities/infrastructure/outcomes-repo";
import { createOrganizationRepo } from "~/server/organization/organization-repo";
import type { WorkspaceDatabase } from "~/server/platform/database/types";

import { createCampaignsRepo } from "../infrastructure/campaigns-repo";

export function bindCampaignsTx(tx: Transaction<WorkspaceDatabase>) {
  return {
    activities: createActivitiesRepo(tx),
    campaigns: createCampaignsRepo(tx),
    organizations: createOrganizationRepo(tx),
    outcomes: createOutcomesRepo(tx),
  };
}

export type CampaignsTx = ReturnType<typeof bindCampaignsTx>;
