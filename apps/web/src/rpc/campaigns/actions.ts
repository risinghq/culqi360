import { CAMPAIGN_IMPORT_BATCH_LINES } from "~/contracts/campaigns/imports";
import type { CampaignImportView } from "~/contracts/campaigns/views";
import { ActivityOutcomeId, CampaignId, CampaignRecordId } from "~/domain/ids";
import { toHeldRecordView } from "~/server/campaigns/ui/queries";
import { getApplication } from "~/server/composition/application";
import { executeSessionServerFunctionResult } from "~/server/platform/action";
import { messageFor } from "~/server/platform/action/domain-error";
import {
  parseObject,
  validationFail,
} from "~/server/platform/action/input-reader";
import { Err, Ok } from "~/shared/result";
import { readTableBody } from "~/shared/table";

function parseCampaignTable(input: unknown) {
  const fields = parseObject(input, validationFail, (r) => ({
    campaignName: r.str("campaignName"),
    segmentColumn: r.str("segmentColumn"),
  }));
  if (!fields.ok) {
    return fields;
  }
  const table = readTableBody(input, CAMPAIGN_IMPORT_BATCH_LINES);
  return table === null
    ? Err(validationFail("", "invalid"))
    : Ok({ ...fields.value, table });
}

/** Imports one batch of a campaign file. The browser reads the file and
 * sends its lines in batches of `CAMPAIGN_IMPORT_BATCH_LINES`. */
export async function importCampaignTable(input: unknown) {
  "use server";

  return executeSessionServerFunctionResult({
    name: "campaigns.import",
    access: { kind: "permission", permission: "campaign:manage" },

    parse: () => parseCampaignTable(input),

    telemetry: ({ campaignName, table }) => ({
      campaignName,
      lines: table.lines.length,
    }),

    execute: async (ctx, command) => {
      const imported = await getApplication().campaigns.importTable(
        command,
        ctx,
      );
      if (!imported.ok) {
        return imported;
      }
      return Ok<CampaignImportView>({
        campaignId: imported.value.campaignId,
        imported: imported.value.imported,
        rejected: imported.value.rejected.map((row) => ({
          line: row.line,
          message: messageFor(row.error),
        })),
      });
    },
  });
}

export async function drawCampaignBatch(input: unknown) {
  "use server";

  return executeSessionServerFunctionResult({
    name: "campaigns.draw",
    access: { kind: "permission", permission: "campaign:work" },

    parse: () =>
      parseObject(input, validationFail, (r) => ({
        campaignId: r.id("campaignId", CampaignId),
        segment: r.optStr("segment"),
      })),

    telemetry: ({ campaignId, segment }) => ({ campaignId, segment }),

    execute: async (ctx, command) => {
      const drawn = await getApplication().campaigns.draw(
        { actorUserId: ctx.actor.userId, ...command },
        ctx,
      );
      return drawn.ok ? Ok(drawn.value.map(toHeldRecordView)) : drawn;
    },
  });
}

export async function releaseCampaignBatch(input: unknown) {
  "use server";

  return executeSessionServerFunctionResult({
    name: "campaigns.release",
    access: { kind: "permission", permission: "campaign:work" },

    parse: () =>
      parseObject(input, validationFail, (r) => ({
        campaignId: r.id("campaignId", CampaignId),
      })),

    telemetry: ({ campaignId }) => ({ campaignId }),

    execute: (ctx, command) =>
      getApplication().campaigns.release(
        { actorUserId: ctx.actor.userId, campaignId: command.campaignId },
        ctx,
      ),
  });
}

export async function markCampaignRecordWorked(input: unknown) {
  "use server";

  return executeSessionServerFunctionResult({
    name: "campaigns.mark_worked",
    access: { kind: "permission", permission: "campaign:work" },

    parse: () =>
      parseObject(input, validationFail, (r) => ({
        recordId: r.id("recordId", CampaignRecordId),
        outcomeId: r.id("outcomeId", ActivityOutcomeId),
        notes: r.optStr("notes"),
      })),

    telemetry: ({ recordId, outcomeId }) => ({ recordId, outcomeId }),

    execute: (ctx, command) =>
      getApplication().campaigns.markWorked(
        {
          actorUserId: ctx.actor.userId,
          branchId: ctx.actor.branchId,
          ...command,
        },
        ctx,
      ),
  });
}
