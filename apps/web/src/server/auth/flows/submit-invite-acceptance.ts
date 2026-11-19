import { validateInviteAcceptance } from "~/domain/auth/invite/activation-input";
import type { DomainError } from "~/domain/errors";
import type { AuthWorkspaces } from "~/server/auth/application/ports";
import type { AuthIdentitiesRepo } from "~/server/auth/identities";
import {
  mintSession,
  openMintedSession,
} from "~/server/auth/session/session.service";
import type { InviteAcceptanceService } from "~/server/invites/application/types";
import type { OperationContext } from "~/server/platform/operation/context";
import { isErr, Ok, type Result } from "~/shared/result";

export async function submitInviteAcceptance(
  deps: {
    invites: Pick<InviteAcceptanceService, "acceptInvite">;
    users: Pick<AuthIdentitiesRepo, "findById">;
    workspaces: Pick<AuthWorkspaces, "openSession">;
  },
  request: {
    ipAddress: string;
    userAgent: string | null;
  },
  input: unknown,
  operation: OperationContext,
): Promise<Result<{ sessionToken: string; redirectTo: string }, DomainError>> {
  const validation = validateInviteAcceptance(input);
  if (isErr(validation)) {
    return validation;
  }

  const acceptance = await deps.invites.acceptInvite(
    validation.value,
    operation,
  );
  if (isErr(acceptance)) {
    return acceptance;
  }

  const user = await deps.users.findById(
    acceptance.value.accountId,
    acceptance.value.workspaceId,
  );
  if (!user) {
    throw new Error("No se pudo activar la cuenta");
  }

  const sessionToken = await openMintedSession(
    deps.workspaces,
    mintSession(
      {
        user,
        sessionClass: "pre_auth",
        request,
        primaryAuthMethod: "password",
        strongAuthMethod: null,
        strongAuthAt: null,
      },
      operation,
    ),
  );
  return Ok({ sessionToken, redirectTo: "/onboarding" });
}
