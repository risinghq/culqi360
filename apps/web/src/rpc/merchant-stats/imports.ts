import {
  GPV_IMPORT_BATCH_LINES,
  isGpvReportHeader,
} from "~/contracts/merchant-stats/imports";
import { fail, invalid, type DomainError } from "~/domain/errors";
import { GpvSnapshotId, GpvSnapshotIssueId } from "~/domain/ids";
import type { GpvSnapshotIssueResolution } from "~/domain/merchant-stats/snapshot";
import { getApplication } from "~/server/composition/application";
import {
  cutAtFromFilename,
  cutAtFromInput,
} from "~/server/merchant-stats/intake/cut-at";
import {
  executeSessionServerFunction,
  executeSessionServerFunctionResult,
} from "~/server/platform/action";
import {
  parseObject,
  validationFail,
} from "~/server/platform/action/input-reader";
import { Err, Ok, type Result } from "~/shared/result";
import { readTableBody, type TableBody } from "~/shared/table";

const SNAPSHOT_RESOLUTIONS = [
  "accept_candidate",
  "keep_previous",
  "exclude_candidate",
  "reject_snapshot",
] as const satisfies readonly GpvSnapshotIssueResolution[];

const SHA256_HEX = /^[0-9a-f]{64}$/;

interface OpenInput {
  contentSha256: string;
  cutAt: Date;
}

// The cut comes from the form, or else from the dealer's filename.
function parseOpen(input: unknown): Result<OpenInput, DomainError> {
  const parsed = parseObject(input, validationFail, (reader) => ({
    fileName: reader.str("fileName", { min: 1, max: 255 }),
    cutAt: reader.optStr("cutAt"),
    contentSha256: reader.str("contentSha256"),
  }));
  if (!parsed.ok) {
    return parsed;
  }
  const { fileName, cutAt: rawCutAt, contentSha256 } = parsed.value;
  if (!SHA256_HEX.test(contentSha256)) {
    return Err(invalid({ code: "invalid_import_file" }));
  }
  const cutAt = rawCutAt
    ? cutAtFromInput(rawCutAt)
    : cutAtFromFilename(fileName);
  if (!cutAt) {
    return Err(fail("gpv_cut_required"));
  }
  return Ok({ contentSha256, cutAt });
}

/** Opens a GPV import for a report the browser has read. A file already
 * imported returns its snapshot instead. */
export async function openGpvImport(input: {
  fileName: string;
  cutAt: string | null;
  contentSha256: string;
}) {
  "use server";

  return executeSessionServerFunctionResult({
    name: "merchantStats.import.open",
    access: { kind: "permission", permission: "dashboards:manage" },

    parse: () => parseOpen(input),

    telemetry: ({ cutAt }) => ({ cutAt: cutAt.toISOString() }),

    execute: async (ctx, { contentSha256, cutAt }) => {
      const opened = await getApplication().merchantStats.imports.open(
        { contentSha256, cutAt, uploadedBy: ctx.actor.userId },
        ctx,
      );
      if (opened.kind === "stale") {
        return Err(
          fail("gpv_snapshot_superseded", {
            details: { activeCutAt: opened.activeCutAt.toISOString() },
          }),
        );
      }
      return Ok({
        snapshotId: opened.snapshotId,
        duplicate: opened.kind === "duplicate",
      });
    },
  });
}

interface StageInput {
  snapshotId: GpvSnapshotId;
  table: TableBody;
}

function parseStage(input: unknown): Result<StageInput, DomainError> {
  const parsed = parseObject(input, validationFail, (reader) => ({
    snapshotId: reader.id("snapshotId", GpvSnapshotId),
  }));
  if (!parsed.ok) {
    return parsed;
  }
  const table =
    typeof input === "object" && input !== null && "table" in input
      ? readTableBody(input.table, GPV_IMPORT_BATCH_LINES)
      : null;
  if (table === null || !isGpvReportHeader(table.columns)) {
    return Err(invalid({ code: "invalid_import_file" }));
  }
  return Ok({ snapshotId: parsed.value.snapshotId, table });
}

/** Stages one batch of report lines. The browser sends the file in batches
 * of `GPV_IMPORT_BATCH_LINES`. */
export async function stageGpvImport(input: {
  snapshotId: string;
  table: TableBody;
}) {
  "use server";

  return executeSessionServerFunction({
    name: "merchantStats.import.stage",
    access: { kind: "permission", permission: "dashboards:manage" },

    parse: () => parseStage(input),

    telemetry: ({ snapshotId, table }) => ({
      snapshotId,
      lines: table.lines.length,
    }),

    execute: (ctx, staged) =>
      getApplication().merchantStats.imports.stage(staged, ctx),
  });
}

/** Closes an import once every batch is staged, and activates it when no
 * issue blocks. */
export async function closeGpvImport(input: { snapshotId: string }) {
  "use server";

  return executeSessionServerFunction({
    name: "merchantStats.import.close",
    access: { kind: "permission", permission: "dashboards:manage" },

    parse: () =>
      parseObject(input, validationFail, (reader) => ({
        snapshotId: reader.id("snapshotId", GpvSnapshotId),
      })),

    telemetry: ({ snapshotId }) => ({ snapshotId }),

    execute: (ctx, { snapshotId }) =>
      getApplication().merchantStats.imports.close(snapshotId, ctx),
  });
}

export async function resolveGpvImportIssue(input: {
  issueId: string;
  resolution: GpvSnapshotIssueResolution;
}) {
  "use server";

  return executeSessionServerFunction({
    name: "merchantStats.import.issue.resolve",
    access: { kind: "permission", permission: "dashboards:manage" },

    parse: () =>
      parseObject(input, validationFail, (reader) => ({
        issueId: reader.id("issueId", GpvSnapshotIssueId),
        resolution: reader.enum("resolution", SNAPSHOT_RESOLUTIONS),
      })),

    telemetry: ({ issueId, resolution }) => ({
      issueId,
      resolution,
    }),

    execute: (ctx, { issueId, resolution }) =>
      getApplication().merchantStats.imports.resolveIssue(
        {
          issueId,
          resolution,
          resolvedBy: ctx.actor.userId,
        },
        ctx,
      ),
  });
}
