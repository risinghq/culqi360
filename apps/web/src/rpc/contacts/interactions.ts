import type { ActionSuccess } from "~/contracts/common";
import { ActivityOutcomeId, ContactHoldId, ContactId } from "~/domain/ids";
import { getApplication } from "~/server/composition/application";
import { executeSessionServerFunction } from "~/server/platform/action";
import {
  parseObject,
  validationFail,
} from "~/server/platform/action/input-reader";

export async function completeContactHoldCall(
  input: unknown,
): Promise<ActionSuccess> {
  "use server";

  return executeSessionServerFunction({
    name: "contact_holds.complete_call",
    access: { kind: "permission", permission: "lead:work" },

    parse: () =>
      parseObject(input, validationFail, (r) => ({
        holdId: r.id("holdId", ContactHoldId),
        contactId: r.id("contactId", ContactId),
        outcomeId: r.id("outcomeId", ActivityOutcomeId),
        notes: r.optStr("notes") ?? null,
      })),

    telemetry: ({ holdId, contactId }) => ({
      holdId,
      contactId,
    }),

    execute: (ctx, command) =>
      getApplication().contactHolds.completeCall(
        {
          actorUserId: ctx.actor.userId,
          branchId: ctx.actor.branchId,
          holdId: command.holdId,
          contactId: command.contactId,
          outcomeId: command.outcomeId,
          notes: command.notes,
        },
        ctx,
      ),
  });
}
