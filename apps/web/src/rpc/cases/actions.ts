import { hasPermission } from "~/domain/auth/access/rbac";
import { fail, invalid } from "~/domain/errors";
import { parseRuc } from "~/domain/identity/document";
import { CaseId, CaseTypeId, UserId } from "~/domain/ids";
import { getApplication } from "~/server/composition/application";
import {
  executeSessionServerFunction,
  executeSessionServerFunctionResult,
} from "~/server/platform/action";
import {
  parseObject,
  validationFail,
} from "~/server/platform/action/input-reader";
import { Err, Ok } from "~/shared/result";

// The case type's definition checks each value; this only rejects a payload
// that is not a map of plain values.
function readValues(input: unknown) {
  const values =
    typeof input === "object" && input !== null && "values" in input
      ? input.values
      : undefined;
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    return Err(validationFail("values", "invalid"));
  }
  const plain: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(values)) {
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number"
    ) {
      return Err(validationFail("values", "invalid"));
    }
    plain[key] = value;
  }
  return Ok(plain);
}

export async function openCase(input: unknown) {
  "use server";

  return executeSessionServerFunctionResult({
    name: "cases.open",
    access: { kind: "permission", permission: "case:work" },

    parse: () => {
      const parsed = parseObject(input, validationFail, (r) => ({
        caseTypeKey: r.str("caseTypeKey"),
        ruc: r.str("ruc"),
      }));
      if (!parsed.ok) {
        return parsed;
      }
      const ruc = parseRuc(parsed.value.ruc);
      if (!ruc.ok) {
        return ruc;
      }
      const values = readValues(input);
      return values.ok
        ? Ok({
            caseTypeKey: parsed.value.caseTypeKey,
            ruc: ruc.value,
            values: values.value,
          })
        : values;
    },

    telemetry: ({ caseTypeKey }) => ({ caseTypeKey }),

    execute: async (ctx, command) => {
      const opened = await getApplication().cases.open(
        {
          actorUserId: ctx.actor.userId,
          actorRoleKey: ctx.actor.roleKey,
          actorBranchId: ctx.actor.branchId,
          ...command,
        },
        ctx,
      );
      return opened.ok ? Ok({ caseId: opened.value.caseId }) : opened;
    },
  });
}

export async function writeCaseStage(input: unknown) {
  "use server";

  return executeSessionServerFunctionResult({
    name: "cases.write_stage",
    access: { kind: "permission", permission: "case:work" },

    parse: () => {
      const parsed = parseObject(input, validationFail, (r) => ({
        caseId: r.id("caseId", CaseId),
        expectedVersion: r.num("expectedVersion"),
        stageKey: r.str("stageKey"),
        status: r.optStr("status") ?? undefined,
      }));
      if (!parsed.ok) {
        return parsed;
      }
      const values = readValues(input);
      return values.ok ? Ok({ ...parsed.value, values: values.value }) : values;
    },

    telemetry: ({ caseId, stageKey, status }) => ({
      caseId,
      stageKey,
      status: status ?? null,
    }),

    execute: async (ctx, command) => {
      const written = await getApplication().cases.writeStage(
        {
          actorUserId: ctx.actor.userId,
          actorRoleKey: ctx.actor.roleKey,
          actorBranchId: ctx.actor.branchId,
          ...command,
        },
        ctx,
      );
      return written.ok ? Ok({ version: written.value.version }) : written;
    },
  });
}

export async function requestCaseReport(input: unknown) {
  "use server";

  return executeSessionServerFunction({
    name: "cases.report",
    access: { kind: "permission", permission: "case:work" },

    parse: () =>
      parseObject(input, validationFail, (r) => ({
        caseTypeId: r.id("caseTypeId", CaseTypeId),
      })),

    telemetry: ({ caseTypeId }) => ({ caseTypeId }),

    execute: (ctx, { caseTypeId }) =>
      getApplication().cases.report({
        caseTypeId,
        actorUserId: ctx.actor.userId,
        viewAll: hasPermission(ctx.actor, "case:view:all"),
        at: ctx.operationAt,
      }),
  });
}

export async function reassignCase(input: unknown) {
  "use server";

  return executeSessionServerFunctionResult({
    name: "cases.reassign",
    access: { kind: "permission", permission: "case:reassign" },

    parse: () =>
      parseObject(input, validationFail, (r) => ({
        caseId: r.id("caseId", CaseId),
        expectedVersion: r.num("expectedVersion"),
        holderUserId: r.id("holderUserId", UserId),
      })),

    telemetry: ({ caseId, holderUserId }) => ({ caseId, holderUserId }),

    execute: async (ctx, command) => {
      const reassigned = await getApplication().cases.reassign(
        { actorUserId: ctx.actor.userId, ...command },
        ctx,
      );
      return reassigned.ok
        ? Ok({ version: reassigned.value.version })
        : reassigned;
    },
  });
}

function readUpload(formData: unknown) {
  if (!(formData instanceof FormData)) {
    return Err(invalid({ code: "invalid_input" }));
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Err(fail("file_required"));
  }
  return Ok({ name: file.name, sizeBytes: file.size, stream: file.stream() });
}

export async function uploadCaseFile(formData: FormData) {
  "use server";

  return executeSessionServerFunctionResult({
    name: "cases.upload_file",
    access: { kind: "permission", permission: "case:work" },
    parse: () => readUpload(formData),
    telemetry: ({ name, sizeBytes }) => ({ fileName: name, sizeBytes }),
    execute: (ctx, file) => getApplication().cases.uploadFile(ctx, file),
  });
}

export async function requestCaseFileToken(input: unknown) {
  "use server";

  return executeSessionServerFunction({
    name: "cases.file_token",
    access: { kind: "permission", permission: "case:work" },

    parse: () =>
      parseObject(input, validationFail, (r) => ({
        caseId: r.id("caseId", CaseId),
        fieldKey: r.str("fieldKey"),
      })),

    telemetry: ({ caseId, fieldKey }) => ({ caseId, fieldKey }),

    execute: (ctx, { caseId, fieldKey }) =>
      getApplication().cases.fileToken(ctx, {
        caseId,
        fieldKey,
        actorUserId: ctx.actor.userId,
        roleKey: ctx.actor.roleKey,
        branchId: ctx.actor.branchId,
        viewAll: hasPermission(ctx.actor, "case:view:all"),
        canReassign: false,
      }),
  });
}
