import { getSessionPath } from "~/domain/auth/access/route-policy";
import { fail, type DomainError } from "~/domain/errors";
import type { AuthSetupContext } from "~/server/auth/infrastructure/setup-context";
import {
  mintReplacementSession,
  openReplacement,
} from "~/server/auth/session/replace-session";
import type { AppContext } from "~/server/platform/action/context";
import { Err, Ok, type Result } from "~/shared/result";

import { regenerateRecoveryCodes } from "./issue-recovery-codes";

export async function regenerateRecoverySetup(
  ctx: AppContext,
  deps: AuthSetupContext,
): Promise<
  Result<{ recoveryCodes: string[]; sessionToken: string }, DomainError>
> {
  const regeneratedAt = ctx.operationAt;

  const result = await deps.uow.run(async (repos) => {
    const user = await repos.users.findById(ctx.actor.userId);

    if (!user?.onboarding_completed_at) {
      return Err(fail("invalid_input"));
    }

    const recoveryCodes = await regenerateRecoveryCodes(
      repos,
      user.id,
      regeneratedAt,
    );

    const session = mintReplacementSession(
      {
        current: ctx.actor,
        user,
        sessionClass: "recovery_setup",
        strongAuthMethod: ctx.actor.strongAuthMethod,
        strongAuthAt: ctx.actor.strongAuthAt,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      ctx,
    );

    return Ok({ recoveryCodes, session });
  });
  return openReplacement(deps.workspaces, result);
}

export async function acknowledgeRecoverySetup(
  ctx: AppContext,
  deps: AuthSetupContext,
): Promise<Result<{ redirectTo: string; sessionToken: string }, DomainError>> {
  if (ctx.actor.sessionClass !== "recovery_setup") {
    return Err(fail("invalid_input"));
  }

  const acknowledgedAt = ctx.operationAt;

  const result = await deps.uow.run(async (repos) => {
    const user = await repos.users.findById(ctx.actor.userId);

    if (!user?.onboarding_completed_at) {
      return Err(fail("invalid_input"));
    }

    const acknowledged = await repos.userRecoveryCodes.acknowledgeActiveSet(
      user.id,
      acknowledgedAt,
    );

    if (!acknowledged) {
      return Err(fail("invalid_input"));
    }

    const session = mintReplacementSession(
      {
        current: ctx.actor,
        user,
        sessionClass: "app",
        strongAuthMethod: ctx.actor.strongAuthMethod,
        strongAuthAt: ctx.actor.strongAuthAt,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      ctx,
    );

    return Ok({ redirectTo: getSessionPath("app"), session });
  });
  return openReplacement(deps.workspaces, result);
}
