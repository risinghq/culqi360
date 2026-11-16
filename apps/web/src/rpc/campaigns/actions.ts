import type { CampaignImportView } from "~/contracts/campaigns/views";
import { fail, type DomainError } from "~/domain/errors";
import { CampaignId, CampaignRecordId } from "~/domain/ids";
import { toHeldRecordView } from "~/server/campaigns/ui/queries";
import { getApplication } from "~/server/composition/application";
import { maxUploadBytesForFilePurpose } from "~/server/files/validators";
import { executeSessionServerFunctionResult } from "~/server/platform/action";
import { messageFor } from "~/server/platform/action/domain-error";
import {
  parseObject,
  validationFail,
} from "~/server/platform/action/input-reader";
import { Err, Ok, type Result } from "~/shared/result";

interface CampaignUpload {
  file: File;
  extension: "csv" | "xlsx";
  campaignName: string;
  segmentColumn: string;
}

function formText(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseCampaignUpload(
  formData: FormData,
): Result<CampaignUpload, DomainError> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Err(fail("file_required"));
  }
  const name = file.name.toLowerCase();
  const extension = name.endsWith(".xlsx")
    ? "xlsx"
    : name.endsWith(".csv")
      ? "csv"
      : null;
  if (extension === null) {
    return Err(fail("unsupported_file_type"));
  }
  if (file.size > maxUploadBytesForFilePurpose("integration_import")) {
    return Err(fail("file_too_large"));
  }
  const campaignName = formText(formData, "campaignName");
  if (campaignName === null) {
    return Err(validationFail("campaignName", "required"));
  }
  const segmentColumn = formText(formData, "segmentColumn");
  if (segmentColumn === null) {
    return Err(validationFail("segmentColumn", "required"));
  }
  return Ok({ file, extension, campaignName, segmentColumn });
}

export async function importCampaignFile(formData: FormData) {
  "use server";

  return executeSessionServerFunctionResult({
    name: "campaigns.import",
    access: { kind: "permission", permission: "campaign:manage" },

    parse: () => parseCampaignUpload(formData),

    telemetry: ({ file, campaignName }) => ({
      campaignName,
      fileName: file.name,
      fileSize: file.size,
    }),

    execute: async (ctx, upload) => {
      const imported = await getApplication().campaigns.importFile(
        {
          campaignName: upload.campaignName,
          bytes: new Uint8Array(await upload.file.arrayBuffer()),
          options: {
            extension: upload.extension,
            segmentColumn: upload.segmentColumn,
          },
        },
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
      })),

    telemetry: ({ recordId }) => ({ recordId }),

    execute: (ctx, command) =>
      getApplication().campaigns.markWorked(
        { actorUserId: ctx.actor.userId, recordId: command.recordId },
        ctx,
      ),
  });
}
