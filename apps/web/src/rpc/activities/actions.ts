import type { DomainError } from "~/domain/errors";
import { ActivityOutcomeId } from "~/domain/ids";
import { getApplication } from "~/server/composition/application";
import { executeSessionServerFunction } from "~/server/platform/action";
import {
  parseObject,
  validationFail,
  type Reader,
} from "~/server/platform/action/input-reader";
import { isErr, Ok } from "~/shared/result";

const OUTCOME_LABEL = { min: 1, max: 80 };
const CHANNELS = ["call", "visit"] as const;

function readFlags(r: Reader<DomainError>) {
  return {
    label: r.str("label", OUTCOME_LABEL),
    contacted: r.optBool("contacted"),
    negotiated: r.optBool("negotiated"),
    callback: r.optBool("callback"),
  };
}

export async function createOutcome(
  input: unknown,
): Promise<{ message: string }> {
  "use server";

  return executeSessionServerFunction({
    name: "activities.outcomes.create",
    access: { kind: "permission", permission: "outcome:manage" },

    parse: () =>
      parseObject(input, validationFail, (r) => ({
        channel: r.enum("channel", CHANNELS),
        ...readFlags(r),
      })),

    telemetry: ({ channel }) => ({ channel }),

    execute: async (ctx, command) => {
      const result = await getApplication().activities.createOutcome(
        command,
        ctx,
      );
      return isErr(result) ? result : Ok({ message: "Resultado creado" });
    },
  });
}

export async function updateOutcome(
  input: unknown,
): Promise<{ message: string }> {
  "use server";

  return executeSessionServerFunction({
    name: "activities.outcomes.update",
    access: { kind: "permission", permission: "outcome:manage" },

    parse: () =>
      parseObject(input, validationFail, (r) => ({
        id: r.id("id", ActivityOutcomeId),
        ...readFlags(r),
      })),

    telemetry: ({ id }) => ({ outcomeId: id }),

    execute: async (_ctx, command) => {
      const result = await getApplication().activities.updateOutcome(command);
      return isErr(result) ? result : Ok({ message: "Resultado actualizado" });
    },
  });
}

export async function archiveOutcome(
  rawId: unknown,
): Promise<{ message: string }> {
  "use server";

  return executeSessionServerFunction({
    name: "activities.outcomes.archive",
    access: { kind: "permission", permission: "outcome:manage" },

    parse: () =>
      parseObject({ id: rawId }, validationFail, (r) => ({
        id: r.id("id", ActivityOutcomeId),
      })),

    telemetry: ({ id }) => ({ outcomeId: id }),

    execute: async (ctx, { id }) => {
      const result = await getApplication().activities.archiveOutcome(id, ctx);
      return isErr(result) ? result : Ok({ message: "Resultado archivado" });
    },
  });
}
