import type { OnboardingSnapshot } from "~/contracts/auth";
import { deleteSessionCookie } from "~/server/auth/session/cookies";
import { getPlatform } from "~/server/composition/application";
import { executeSessionServerFunction } from "~/server/platform/action";
import {
  parseObject,
  validationFail,
} from "~/server/platform/action/input-reader";

export async function changeOnboardingPassword(input: {
  password: unknown;
  confirmPassword: unknown;
}): Promise<OnboardingSnapshot> {
  "use server";

  const snapshot = await executeSessionServerFunction({
    name: "auth.onboarding.change_password",
    access: { kind: "session" },

    parse: () =>
      parseObject(input, validationFail, (reader) => ({
        password: reader.str("password"),
        confirmPassword: reader.str("confirmPassword"),
      })),

    execute: async (ctx, credentials) => {
      const passwordChange = await getPlatform().auth.onboarding.changePassword(
        ctx,
        credentials,
      );

      if (!passwordChange.ok) {
        return passwordChange;
      }

      return getPlatform().auth.onboarding.snapshot({
        userId: ctx.actor.userId,
        workspaceId: ctx.actor.workspaceId,
      });
    },
  });

  // The password change revokes the current session.
  deleteSessionCookie();

  return snapshot;
}
