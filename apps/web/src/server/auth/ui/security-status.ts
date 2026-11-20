import type { AccountSecurityStatus } from "~/contracts/auth";
import { getPlatform } from "~/server/composition/application";
import { executeSessionServerFunction } from "~/server/platform/action";
import { Ok } from "~/shared/result";

export async function getSecurityStatus(): Promise<AccountSecurityStatus> {
  return executeSessionServerFunction({
    name: "auth.security.status",
    access: { kind: "session" },

    execute: async ({ actor }) =>
      Ok(await getPlatform().auth.security.status(actor.userId)),
  });
}
