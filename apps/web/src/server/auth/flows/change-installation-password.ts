import { fail, type DomainError } from "~/domain/errors";
import type { UserId } from "~/domain/ids";
import {
  accountChange,
  endAccountSessions,
} from "~/server/auth/application/account-workspaces";
import { hashPassword, verifyPassword } from "~/server/auth/password/password";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";

import type { AuthSetupContext } from "../infrastructure/setup-context";

export async function changeInstallationPassword(
  deps: AuthSetupContext,
  input: {
    userId: UserId;
    password: string;
    confirmPassword: string;
  },
  operation: OperationContext,
): Promise<Result<void, DomainError>> {
  if (input.password.length < 8) {
    return Err(fail("password_too_short"));
  }
  if (input.password !== input.confirmPassword) {
    return Err(fail("password_mismatch"));
  }

  const user = await deps.repos.users.findById(input.userId);
  if (!user) {
    return Err(fail("user_not_found"));
  }
  if (!user.password_change_required) {
    return Ok(undefined);
  }
  if (await verifyPassword(user.password_hash, input.password)) {
    return Err(fail("installation_password_must_change"));
  }

  const passwordHash = await hashPassword(input.password);

  await deps.repos.users.replaceInstallationPassword(user.id, passwordHash);
  await endAccountSessions(
    { users: deps.repos.users, workspaces: deps.workspaces },
    {
      userId: user.id,
      endedAt: operation.operationAt,
      event: accountChange("password_changed", user.id, operation.operationAt),
    },
  );

  return Ok(undefined);
}
