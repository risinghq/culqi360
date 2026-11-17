import type {
  CampaignView,
  HeldCampaignRecordView,
  SegmentAvailabilityView,
} from "~/contracts/campaigns/views";
import { CampaignId } from "~/domain/ids";
import { getApplication } from "~/server/composition/application";
import { executeSessionServerFunction } from "~/server/platform/action";
import {
  parseObject,
  validationFail,
} from "~/server/platform/action/input-reader";
import { Ok } from "~/shared/result";

import type { HeldRecord } from "../infrastructure/campaigns-repo";

export function toHeldRecordView(record: HeldRecord): HeldCampaignRecordView {
  return {
    id: record.id,
    organizationId: record.organizationId,
    ruc: record.ruc,
    legalName: record.legalName,
    segment: record.segment,
    facts: record.facts,
  };
}

const parseCampaign = (input: unknown) =>
  parseObject(input, validationFail, (r) => ({
    campaignId: r.id("campaignId", CampaignId),
  }));

export async function listCampaigns(): Promise<CampaignView[]> {
  return executeSessionServerFunction({
    name: "campaigns.list",
    access: { kind: "permission", permission: "campaign:work" },
    execute: async () => {
      const campaigns = await getApplication().campaigns.list();
      return Ok(
        campaigns.map((campaign) => ({
          id: campaign.id,
          name: campaign.name,
          createdAt: campaign.createdAt.getTime(),
        })),
      );
    },
  });
}

export async function getMyCampaignBatch(
  input: unknown,
): Promise<HeldCampaignRecordView[]> {
  return executeSessionServerFunction({
    name: "campaigns.held",
    access: { kind: "permission", permission: "campaign:work" },
    parse: () => parseCampaign(input),
    execute: async (ctx, { campaignId }) => {
      const held = await getApplication().campaigns.held({
        actorUserId: ctx.actor.userId,
        campaignId,
      });
      return Ok(held.map(toHeldRecordView));
    },
  });
}

export async function getCampaignAvailability(
  input: unknown,
): Promise<SegmentAvailabilityView[]> {
  return executeSessionServerFunction({
    name: "campaigns.availability",
    access: { kind: "permission", permission: "campaign:work" },
    parse: () => parseCampaign(input),
    execute: async (_ctx, { campaignId }) =>
      Ok(await getApplication().campaigns.availableBySegment(campaignId)),
  });
}
