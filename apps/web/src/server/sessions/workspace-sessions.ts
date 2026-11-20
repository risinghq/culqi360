import type { Kysely, Transaction } from "kysely";

import { auditEntityId } from "~/domain/audit/entity";
import { canImpersonateMember } from "~/domain/auth/access/member-management";
import type { AuthSession } from "~/domain/auth/access/session-types";
import { effectivePermissions } from "~/domain/auth/access/workspace-modules";
import { fail, type DomainError } from "~/domain/errors";
import type { UserId, WorkspaceId } from "~/domain/ids";
import { addMilliseconds } from "~/domain/time/clock";
import {
  ACTIVITY_UPDATE_THRESHOLD_MS,
  EXTENSION_THRESHOLD_MS,
  SESSION_DURATION_MS,
} from "~/server/auth/session/lifetime";
import { mapUserSessionRowToAuthSession } from "~/server/auth/session/session-mappers";
import { mintSession } from "~/server/auth/session/session.service";
import { hashSessionToken } from "~/server/auth/session/tokens";
import {
  createEventsWriter,
  type EventToAppend,
} from "~/server/event-logs/events-repo";
import { endMemberExtensionAccess } from "~/server/extension/end-member-access";
import { createExtensionRuntimeRepo } from "~/server/extension/repos";
import type { AppContext } from "~/server/platform/action/context";
import type { WorkspaceDatabase } from "~/server/platform/database/types";
import type { OperationContext } from "~/server/platform/operation/context";
import { createMembersRepo } from "~/server/users/repos-members";
import { Err, Ok, type Result } from "~/shared/result";

import {
  createSessionRepository,
  type NewUserSessionRow,
} from "./repos-sessions";

export interface EndSessions {
  userId: UserId;
  // Without a session id, every session of the member ends.
  sessionId?: string;
  endedAt: Date;
  // The audit of what ended them, filed in the same write.
  event?: EventToAppend;
}

export interface NewLoginSourceAudit {
  since: Date;
  event: EventToAppend;
}

export interface OpenSession {
  session: NewUserSessionRow;
  replaces?: string;
  // The audit of the sign-in, filed in the same write.
  event?: EventToAppend;
  ifNewIp?: NewLoginSourceAudit;
}

// Deletes the sessions, ends the extension access bound to them so a
// signed-out member keeps no installation alive, and files the audit.
async function endSessionsIn(
  tx: Transaction<WorkspaceDatabase>,
  input: EndSessions,
): Promise<void> {
  await createSessionRepository(tx).deleteForUser(
    input.userId,
    input.sessionId,
  );
  await endMemberExtensionAccess(createExtensionRuntimeRepo(tx), {
    accountId: input.userId,
    authSessionId: input.sessionId,
    endedAt: input.endedAt,
  });
  if (input.event) {
    await createEventsWriter(tx).append(input.event);
  }
}

// The sessions of one workspace's members. A request resolves its session and
// its member here in one store call.
export function createWorkspaceSessions(
  db: Kysely<WorkspaceDatabase>,
  workspaceId: WorkspaceId,
) {
  const sessions = createSessionRepository(db);
  const members = createMembersRepo(db);

  const inTx = <T>(run: (tx: Transaction<WorkspaceDatabase>) => Promise<T>) =>
    db.transaction().execute(run);

  return {
    async resolve(
      token: string,
      operation: OperationContext,
    ): Promise<AuthSession | null> {
      const sessionId = hashSessionToken(token);
      const session = await sessions.findById(sessionId);
      if (!session) {
        return null;
      }
      const now = operation.operationAt;
      if (session.expires_at < now) {
        await sessions.delete(sessionId);
        return null;
      }

      const member = await members.findForSession(session.user_id);
      if (!member?.is_active) {
        await sessions.delete(sessionId);
        return null;
      }
      if (member.expires_at !== null && member.expires_at <= now) {
        return null;
      }

      const changes: { last_activity?: Date; expires_at?: Date } = {};
      if (
        now.getTime() - session.last_activity.getTime() >
        ACTIVITY_UPDATE_THRESHOLD_MS
      ) {
        changes.last_activity = now;
      }
      if (
        session.expires_at.getTime() - now.getTime() <
        EXTENSION_THRESHOLD_MS
      ) {
        changes.expires_at = addMilliseconds(now, SESSION_DURATION_MS);
      }
      if (Object.keys(changes).length > 0) {
        await sessions.touch(sessionId, changes);
      }

      const { modules } = member;
      return mapUserSessionRowToAuthSession(
        sessionId,
        {
          workspaceId,
          modules,
          branchId: member.branch_id,
          role: member.role,
          roleId: member.role_id,
          roleKey: member.role_key,
          roleName: member.role_name,
          permissions: effectivePermissions(member.role_permissions, modules),
          assignableRoleIds: member.assignable_role_ids,
        },
        session,
      );
    },

    // Opens a session issued at sign-in, deleting the one it replaces. With
    // `ifNewIp`, it first appends that event when the member opened no session
    // from this IP since the given time.
    open(input: OpenSession) {
      return inTx(async (tx) => {
        const repo = createSessionRepository(tx);
        const events = createEventsWriter(tx);
        const { session, ifNewIp } = input;
        if (input.event) {
          await events.append(input.event);
        }
        if (
          ifNewIp &&
          !(await repo.hasRecentFromIp(
            session.user_id,
            session.ip_address,
            ifNewIp.since,
          ))
        ) {
          await events.append(ifNewIp.event);
        }
        await repo.create(session);
        if (input.replaces !== undefined) {
          await repo.deleteForUser(session.user_id, input.replaces);
        }
      });
    },

    end(input: EndSessions): Promise<void> {
      return inTx((tx) => endSessionsIn(tx, input));
    },

    // Cookie clearing stays in the HTTP layer.
    async logout(ctx: AppContext): Promise<Result<void, DomainError>> {
      const { id, userId } = ctx.actor;
      await inTx((tx) =>
        endSessionsIn(tx, {
          userId,
          sessionId: id,
          endedAt: ctx.operationAt,
          event: {
            type: "logout",
            entityType: "user",
            entityId: auditEntityId("user", userId),
            actorUserId: userId,
            occurredAt: ctx.operationAt,
          },
        }),
      );
      return Ok(undefined);
    },

    // Mints a session that acts as the target and records the administrator
    // on it. The caller keeps the administrator's own cookie to return to.
    async startImpersonation(
      ctx: AppContext,
      command: { userId: UserId },
    ): Promise<Result<{ token: string }, DomainError>> {
      if (command.userId === ctx.actor.userId) {
        return Err(fail("cannot_manage_self"));
      }
      const target = await members.findForSession(command.userId);
      if (!target || target.branch_id !== ctx.actor.branchId) {
        return Err(fail("user_not_found"));
      }
      if (
        !target.is_active ||
        !canImpersonateMember(ctx.actor, {
          id: target.role_id,
          kind: target.role,
        })
      ) {
        return Err(fail("cannot_impersonate"));
      }

      const { token, row } = mintSession(
        {
          user: {
            id: target.user_id,
            workspace_id: workspaceId,
            branch_id: target.branch_id,
            role: target.role,
            onboarding_completed_at: target.onboarding_completed_at,
          },
          sessionClass: "app",
          request: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
          primaryAuthMethod: ctx.actor.primaryAuthMethod,
          strongAuthMethod: null,
          strongAuthAt: null,
          impersonatorUserId: ctx.actor.userId,
        },
        ctx,
      );
      await inTx(async (tx) => {
        await createSessionRepository(tx).create(row);
        await appendImpersonation(tx, {
          type: "user.impersonation_started",
          actorUserId: ctx.actor.userId,
          subjectUserId: target.user_id,
          occurredAt: ctx.operationAt,
        });
      });
      return Ok({ token });
    },

    async stopImpersonation(
      ctx: AppContext,
    ): Promise<Result<void, DomainError>> {
      const { impersonatorUserId } = ctx.actor;
      if (impersonatorUserId === null) {
        return Err(fail("not_impersonating"));
      }
      await inTx(async (tx) => {
        await createSessionRepository(tx).delete(ctx.actor.id);
        await appendImpersonation(tx, {
          type: "user.impersonation_stopped",
          actorUserId: impersonatorUserId,
          subjectUserId: ctx.actor.userId,
          occurredAt: ctx.operationAt,
        });
      });
      return Ok(undefined);
    },
  };
}

function appendImpersonation(
  tx: Transaction<WorkspaceDatabase>,
  event: Pick<EventToAppend, "type" | "occurredAt"> & {
    actorUserId: UserId;
    subjectUserId: UserId;
  },
) {
  return createEventsWriter(tx).append({
    ...event,
    entityType: "user",
    entityId: auditEntityId("user", event.subjectUserId),
  });
}

export type WorkspaceSessions = ReturnType<typeof createWorkspaceSessions>;
