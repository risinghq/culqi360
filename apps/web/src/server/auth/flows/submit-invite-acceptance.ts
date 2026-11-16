import { validateInviteAcceptance } from "~/domain/auth/invite/activation-input";
import { fail, type DomainError } from "~/domain/errors";
import { createSessionIssuer } from "~/server/auth/session/session.service";
import type {
  AcceptInviteInput,
  InviteService,
} from "~/server/invites/application/types";
import { runInWorkspace } from "~/server/platform/database/workspace-scope";
import type { OperationContext } from "~/server/platform/operation/context";
import type { SessionRepository } from "~/server/sessions/repos-sessions";
import type { UsersRepo } from "~/server/users/repos-users";
import { Err, isErr, Ok, type Result } from "~/shared/result";

export async function submitInviteAcceptance(
  deps: {
    inviteService: InviteService;
    repos: {
      users: UsersRepo;
      sessions: SessionRepository;
    };
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

  // The request is anonymous and runs at platform scope. The invite names the
  // workspace, so its writes and audit event are tagged with that workspace.
  const workspaceId = await deps.inviteService.findPendingInviteWorkspace(
    validation.value.token,
    operation,
  );

  if (!workspaceId) {
    return Err(fail("invite_invalid_or_expired"));
  }

  return runInWorkspace(workspaceId, () =>
    acceptAndSignIn(deps, request, validation.value, operation),
  );
}

async function acceptAndSignIn(
  deps: Parameters<typeof submitInviteAcceptance>[0],
  request: Parameters<typeof submitInviteAcceptance>[1],
  acceptanceInput: AcceptInviteInput,
  operation: OperationContext,
): Promise<Result<{ sessionToken: string; redirectTo: string }, DomainError>> {
  const acceptance = await deps.inviteService.acceptInvite(
    acceptanceInput,
    operation,
  );

  if (isErr(acceptance)) {
    return acceptance;
  }

  const user = await deps.repos.users.findById(acceptance.value.userId);

  if (!user) {
    throw new Error("No se pudo activar la cuenta");
  }

  const session = await createSessionIssuer({
    sessions: deps.repos.sessions,
  }).establish(
    {
      user,
      sessionClass: "pre_auth",
      request,
      primaryAuthMethod: "password",
      strongAuthMethod: null,
      strongAuthAt: null,
    },
    operation,
  );

  if (isErr(session)) {
    return session;
  }

  return Ok({
    sessionToken: session.value.token,
    redirectTo: "/onboarding",
  });
}
