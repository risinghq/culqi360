import type { AuthSession } from "~/domain/auth/access/session-types";
import type { AuthWorkspaces } from "~/server/auth/application/ports";
import type { OperationContext } from "~/server/platform/operation/context";
import { isErr, Ok, type Result } from "~/shared/result";

import type { MintedSession, SessionSpec, SessionUser } from "./session-spec";
import { mintSession, openMintedSession } from "./session.service";

// Mints the session that takes the current one's place once a factor, a
// recovery set or onboarding changes what the member may do. Opening it
// deletes the current session in the same workspace write.
export function mintReplacementSession(
  input: {
    current: AuthSession;
    user: SessionUser;
    sessionClass: SessionSpec["sessionClass"];
    strongAuthMethod: SessionSpec["strongAuthMethod"];
    strongAuthAt: Date | null;
    ipAddress: string;
    userAgent: string | null;
  },
  operation: OperationContext,
): MintedSession {
  return mintSession(
    {
      user: input.user,
      sessionClass: input.sessionClass,
      request: {
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      primaryAuthMethod: input.current.primaryAuthMethod,
      strongAuthMethod: input.strongAuthMethod,
      strongAuthAt: input.strongAuthAt,
      replaces: input.current.id,
    },
    operation,
  );
}

// Opens the session a committed flow minted and hands back its token in place
// of it.
export async function openReplacement<T, E>(
  workspaces: Pick<AuthWorkspaces, "openSession">,
  result: Result<T & { session: MintedSession }, E>,
): Promise<Result<Omit<T, "session"> & { sessionToken: string }, E>> {
  if (isErr(result)) {
    return result;
  }
  const { session, ...rest } = result.value;
  return Ok({
    ...rest,
    sessionToken: await openMintedSession(workspaces, session),
  });
}
