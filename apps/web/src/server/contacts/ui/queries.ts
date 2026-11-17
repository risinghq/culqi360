import type { DrawCapacitySnapshot } from "~/contracts/capacity";
import type { MyContactHoldView } from "~/contracts/contacts/views";
import { getApplication } from "~/server/composition/application";
import { executeSessionServerFunction } from "~/server/platform/action";

export async function getMyContactHoldCapacity(): Promise<DrawCapacitySnapshot> {
  return executeSessionServerFunction({
    name: "contact_holds.get_capacity",
    access: { kind: "permission", permission: "capacity:read:self" },
    execute: (ctx) =>
      getApplication().contactHolds.getCapacity(ctx.actor.userId, ctx),
  });
}

export async function getMyContactHolds(): Promise<MyContactHoldView[]> {
  return executeSessionServerFunction({
    name: "contact_holds.list_mine",
    access: { kind: "permission", permission: "lead:work" },
    execute: (ctx) =>
      getApplication().contactHolds.listActive(ctx.actor.userId, ctx),
  });
}
