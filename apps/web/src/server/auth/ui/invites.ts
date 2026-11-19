import type { InviteActivationView } from "~/contracts/auth";
import { readInviteToken } from "~/domain/auth/invite/activation-input";
import { setSessionCookie } from "~/server/auth/session/cookies";
import { getPlatform } from "~/server/composition/application";
import { throwDomain } from "~/server/platform/action/domain-error";
import {
  getRequestClientMetadata,
  getRequestOperation,
} from "~/server/platform/http/request-context-storage";
import { isErr } from "~/shared/result";

export async function getInviteActivationView(
  tokenInput: unknown,
): Promise<InviteActivationView | null> {
  const safeToken = readInviteToken(tokenInput);
  if (isErr(safeToken)) {
    return null;
  }
  return getPlatform().invites.findInviteInfo(
    safeToken.value,
    getRequestOperation(),
  );
}

export async function acceptInvitePasswordStep(
  input: unknown,
): Promise<{ redirectTo: string }> {
  const request = getRequestClientMetadata();

  const result = await getPlatform().auth.invites.acceptPassword(
    input,
    {
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
    },
    getRequestOperation(),
  );

  if (isErr(result)) {
    throwDomain(result.error);
  }

  setSessionCookie(result.value.sessionToken);
  return { redirectTo: result.value.redirectTo };
}
