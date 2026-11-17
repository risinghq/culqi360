import { getApplication } from "~/server/composition/application";
import { executeSessionServerFunction } from "~/server/platform/action";

export async function assignCurrentUserContacts() {
  "use server";

  return executeSessionServerFunction({
    name: "contact_holds.assign_current_user",
    access: { kind: "permission", permission: "lead:work" },
    execute: (ctx) =>
      getApplication().contactHolds.assign(
        { actorUserId: ctx.actor.userId, branchId: ctx.actor.branchId },
        ctx,
      ),
  });
}
