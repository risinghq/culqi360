import { setSessionCookie } from "~/server/auth/session/cookies";
import { getPlatform } from "~/server/composition/application";
import { executeSessionServerFunction } from "~/server/platform/action";

export async function regenerateRecoveryCodes(): Promise<{
  recoveryCodes: string[];
}> {
  "use server";

  const result = await executeSessionServerFunction({
    name: "auth.recovery.regenerate",
    access: { kind: "session" },
    execute: (context) => getPlatform().auth.recoveryCodes.regenerate(context),
  });

  setSessionCookie(result.sessionToken);
  return { recoveryCodes: result.recoveryCodes };
}

export async function acknowledgeRecoveryCodes(): Promise<{
  redirectTo: string;
}> {
  "use server";

  const result = await executeSessionServerFunction({
    name: "auth.recovery.acknowledge",
    access: { kind: "session" },
    execute: (context) => getPlatform().auth.recoveryCodes.acknowledge(context),
  });

  setSessionCookie(result.sessionToken);
  return { redirectTo: result.redirectTo };
}
