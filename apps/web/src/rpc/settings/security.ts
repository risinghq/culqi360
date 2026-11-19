import { deleteSessionCookie } from "~/server/auth/session/cookies";
import { getPlatform } from "~/server/composition/application";
import { executeSessionServerFunction } from "~/server/platform/action";
import {
  parseObject,
  validationFail,
} from "~/server/platform/action/input-reader";

export async function changePassword(
  currentPassword: unknown,
  newPassword: unknown,
): Promise<{ message: string }> {
  "use server";

  const result = await executeSessionServerFunction({
    name: "settings.security.change_password",
    access: { kind: "auth" },

    parse: () =>
      parseObject({ currentPassword, newPassword }, validationFail, (r) => ({
        currentPassword: r.str("currentPassword"),
        newPassword: r.str("newPassword"),
      })),

    execute: (ctx, input) =>
      getPlatform().auth.security.changePassword(
        ctx,
        input.currentPassword,
        input.newPassword,
      ),
  });

  // changePassword revokes the current session, so clear the now-invalid cookie.
  deleteSessionCookie();

  return result;
}

export async function removeAllPasskeys(): Promise<{ message: string }> {
  "use server";

  return executeSessionServerFunction({
    name: "settings.security.remove_passkeys",
    access: { kind: "session" },

    execute: (ctx) => getPlatform().auth.security.removePasskeys(ctx),
  });
}

export async function disableTotp(): Promise<{ message: string }> {
  "use server";

  return executeSessionServerFunction({
    name: "settings.security.disable_totp",
    access: { kind: "session" },

    execute: (ctx) => getPlatform().auth.security.disableTotp(ctx),
  });
}
