import { auditEntityId } from "~/domain/audit/entity";
import type { DomainError } from "~/domain/errors";
import type { AccessSecurityDeps } from "~/server/auth/application/ports";
import type { AppContext } from "~/server/platform/action/context";
import { Ok, type Result } from "~/shared/result";

// Cookie clearing stays in the HTTP layer because this flow also runs in workers.
export async function logoutUser(
  ctx: AppContext,
  deps: AccessSecurityDeps,
): Promise<Result<void, DomainError>> {
  const { id, userId, workspaceId } = ctx.actor;
  const now = ctx.operationAt;

  const result = await deps.uow.run(async (tx) => {
    await tx.sessions.delete(id);
    await tx.events.append({
      workspaceId,
      type: "logout",
      entityType: "user",
      entityId: auditEntityId("user", userId),
      actorUserId: userId,
      occurredAt: now,
    });
    return Ok(undefined);
  });
  if (!result.ok) {
    return result;
  }
  await deps.workspaces.endExtensionAccess(workspaceId, {
    accountId: userId,
    authSessionId: id,
    endedAt: now,
  });
  return result;
}
