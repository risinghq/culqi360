import type {
  BulkApplyResult,
  BulkPreviewResult,
} from "~/contracts/team/bulk-import";
import { RoleId } from "~/domain/ids";
import { getApplication } from "~/server/composition/application";
import { executeSessionServerFunction } from "~/server/platform/action";
import {
  parseObject,
  validationFail,
} from "~/server/platform/action/input-reader";

export async function previewBulkCsv(
  csvContent: unknown,
  roleId: unknown,
): Promise<BulkPreviewResult> {
  "use server";

  const parsed = await executeSessionServerFunction({
    name: "team.bulk_import.preview",
    access: { kind: "permission", permission: "admin:manage" },

    parse: () =>
      parseObject({ csvContent, roleId }, validationFail, (r) => ({
        csvContent: r.str("csvContent"),
        roleId: r.id("roleId", RoleId),
      })),

    telemetry: (input) => ({ roleId: input.roleId }),

    execute: (ctx, input) =>
      getApplication().team.invites.previewBulkImport(ctx, input),
  });

  return { parsed };
}

export async function applyBulkImport(
  csvContent: unknown,
  roleId: unknown,
): Promise<BulkApplyResult> {
  "use server";

  return executeSessionServerFunction({
    name: "team.bulk_import.apply",
    access: { kind: "permission", permission: "admin:manage" },

    parse: () =>
      parseObject({ csvContent, roleId }, validationFail, (r) => ({
        csvContent: r.str("csvContent"),
        roleId: r.id("roleId", RoleId),
      })),

    telemetry: (input) => ({ roleId: input.roleId }),

    execute: (ctx, input) =>
      getApplication().team.invites.applyBulkImport(ctx, input),
  });
}
