import type { Transaction } from "kysely";

import { auditEntityId } from "~/domain/audit/entity";
import { fail } from "~/domain/errors";
import type { UserId, WorkspaceId } from "~/domain/ids";
import type { AuthWorkspaces } from "~/server/auth/application/ports";
import { getCurrentUser } from "~/server/auth/application/queries/get-current-user";
import { getLoginFlowState } from "~/server/auth/application/queries/get-login-flow-state";
import { listAllActiveSessions } from "~/server/auth/application/queries/list-all-active-sessions";
import {
  verifyPasskeyEnrollment,
  verifyPasskeyLogin,
} from "~/server/auth/factors/passkey/service";
import { verifyTotpEnrollment } from "~/server/auth/factors/totp-enrollment";
import { changeInstallationPassword } from "~/server/auth/flows/change-installation-password";
import { completeFactorEnrollment } from "~/server/auth/flows/complete-factor-enrollment";
import { completePendingLogin } from "~/server/auth/flows/complete-pending-login";
import { completeGoogleOAuthCallback } from "~/server/auth/flows/google-callback-login";
import { logoutUser } from "~/server/auth/flows/logout-user";
import { requestPasswordReset } from "~/server/auth/flows/request-password-reset";
import { resetPassword } from "~/server/auth/flows/reset-password";
import { revokeAllUserSessions } from "~/server/auth/flows/revoke-all-user-sessions";
import { revokeUserSession } from "~/server/auth/flows/revoke-user-session";
import { startPasskeyEnrollment } from "~/server/auth/flows/start-passkey-enrollment";
import { startPasskeyLogin } from "~/server/auth/flows/start-passkey-login";
import { startTotpEnrollment } from "~/server/auth/flows/start-totp-enrollment";
import { submitInviteAcceptance } from "~/server/auth/flows/submit-invite-acceptance";
import { submitPasswordLogin } from "~/server/auth/flows/submit-password-login";
import {
  verifyRecoveryLoginProof,
  verifyTotpLoginProof,
} from "~/server/auth/flows/verify-pending-login";
import { createAuthIdentitiesRepo } from "~/server/auth/identities";
import { createAuthLoginContext } from "~/server/auth/infrastructure/login-context";
import { createPasswordResetContext } from "~/server/auth/infrastructure/password-reset-context";
import { createPasskeyProviderForOrigin } from "~/server/auth/infrastructure/request-passkey-provider";
import { createAuthSessionReadContext } from "~/server/auth/infrastructure/session-context";
import { createAccessSecurityContext } from "~/server/auth/infrastructure/session-revocation-context";
import { createAuthSetupContext } from "~/server/auth/infrastructure/setup-context";
import { completeOnboarding } from "~/server/auth/onboarding/complete";
import { saveOnboardingProfile } from "~/server/auth/onboarding/save-profile";
import { loadOnboardingSnapshot } from "~/server/auth/onboarding/snapshot";
import { hashPassword, verifyPassword } from "~/server/auth/password/password";
import {
  acknowledgeRecoverySetup,
  regenerateRecoverySetup,
} from "~/server/auth/recovery/recovery-setup";
import { canRemoveStrongAuthFactor } from "~/server/auth/security/factor-management-policy";
import { getStrongAuthStatus } from "~/server/auth/security/strong-auth-status";
import {
  startImpersonation,
  stopImpersonation,
} from "~/server/auth/session/impersonation";
import {
  endExtensionAccessIn,
  revokeUserAccess,
} from "~/server/auth/session/revoke-user-access";
import {
  createSessionAuthenticator,
  createSessionIssuer,
} from "~/server/auth/session/session.service";
import { createPlatformEventsWriter } from "~/server/event-logs/platform-events-repo";
import type { InviteAcceptanceService } from "~/server/invites/application/types";
import type { MessagingGateway } from "~/server/notifications/channels/messaging-gateway";
import type { AppContext } from "~/server/platform/action/context";
import type { PlatformDatabase } from "~/server/platform/database/types";
import { createExecutorUow } from "~/server/platform/database/uow";
import type { PlatformInfrastructure } from "~/server/platform/infrastructure";
import type { OperationContext } from "~/server/platform/operation/context";
import { createSessionRepository } from "~/server/sessions/repos-sessions";
import { Err, Ok } from "~/shared/result";

// Auth runs on the platform store. Member data comes through `workspaces`, and
// invite acceptance places the member through its own workspace port.
export function createAuthRuntime(
  platform: PlatformInfrastructure,
  deps: {
    workspaces: AuthWorkspaces;
    invites: Pick<InviteAcceptanceService, "acceptInvite">;
    messaging: MessagingGateway;
  },
) {
  const { db, logger } = platform;
  const { workspaces } = deps;
  const sessionAuthenticator = createSessionAuthenticator({
    sessions: createSessionRepository(db),
    workspaces,
    logger,
  });

  const setup = createAuthSetupContext(db, workspaces);

  const createImpersonationDeps = (tx: Transaction<PlatformDatabase>) => ({
    sessionIssuer: createSessionIssuer({
      sessions: createSessionRepository(tx),
    }),
    sessionAuthenticator: createSessionAuthenticator({
      sessions: createSessionRepository(tx),
      workspaces,
      logger,
    }),
    users: createAuthIdentitiesRepo(tx, workspaces),
    events: createPlatformEventsWriter(tx),
  });
  const login = createAuthLoginContext(db, workspaces);
  const impersonationUow = createExecutorUow(db, createImpersonationDeps);
  const sessionRead = createAuthSessionReadContext(db, workspaces);
  const sessionRevocation = createAccessSecurityContext(db, workspaces);
  const adminSessions = createSessionRepository(db);
  const passwordReset = createPasswordResetContext({
    executor: db,
    workspaces,
    messaging: deps.messaging,
  });
  const loadAccountSecurityState = async (
    userId: UserId,
    workspaceId: WorkspaceId,
  ) => {
    const user = await setup.repos.users.findById(userId, workspaceId);
    if (!user) {
      return Err(fail("user_not_found"));
    }

    return Ok({
      user,
      strongAuthStatus: await getStrongAuthStatus(userId, setup.repos),
    });
  };

  const changeAccountPassword = async (
    ctx: AppContext,
    currentPassword: string,
    newPassword: string,
  ) => {
    const { userId, workspaceId } = ctx.actor;
    const changedAt = ctx.operationAt;
    const state = await loadAccountSecurityState(userId, workspaceId);
    if (!state.ok) {
      return state;
    }

    const valid = await verifyPassword(
      state.value.user.password_hash,
      currentPassword,
    );
    if (!valid) {
      return Err(fail("current_password_incorrect"));
    }

    const passwordHash = await hashPassword(newPassword);
    const revoked = await setup.uow.run(async (repos) => {
      await repos.users.updatePassword(userId, passwordHash);
      const workspaceIds = await revokeUserAccess(repos, userId);
      await repos.events.append({
        workspaceId,
        type: "password_changed",
        entityType: "user",
        entityId: auditEntityId("user", userId),
        actorUserId: userId,
        subjectUserId: userId,
        occurredAt: changedAt,
      });
      return Ok(workspaceIds);
    });
    if (!revoked.ok) {
      return revoked;
    }

    await endExtensionAccessIn(workspaces, revoked.value, {
      accountId: userId,
      endedAt: changedAt,
    });
    return Ok({ message: "Contraseña actualizada" });
  };

  const removeAccountPasskeys = async (ctx: AppContext) => {
    const { userId, workspaceId } = ctx.actor;
    const removedAt = ctx.operationAt;
    const state = await loadAccountSecurityState(userId, workspaceId);
    if (!state.ok) {
      return state;
    }

    const { user, strongAuthStatus } = state.value;
    if (
      !canRemoveStrongAuthFactor({
        role: user.role,
        removingTotp: false,
        removingPasskeys: true,
        hasTotp: strongAuthStatus.hasTotp,
        hasPasskey: strongAuthStatus.hasPasskey,
      })
    ) {
      return Err(fail("strong_method_required"));
    }

    return setup.uow.run(async (repos) => {
      await repos.passkeys.deleteAllByAccount(userId);
      if (!strongAuthStatus.hasTotp) {
        await repos.userRecoveryCodes.deleteAllByAccount(userId);
      }
      await repos.events.append({
        workspaceId,
        type: "passkeys_removed",
        entityType: "user",
        entityId: auditEntityId("user", userId),
        actorUserId: userId,
        occurredAt: removedAt,
      });
      return Ok({ message: "Claves de acceso eliminadas" });
    });
  };

  const disableAccountTotp = async (ctx: AppContext) => {
    const { userId, workspaceId } = ctx.actor;
    const disabledAt = ctx.operationAt;
    const state = await loadAccountSecurityState(userId, workspaceId);
    if (!state.ok) {
      return state;
    }

    const { user, strongAuthStatus } = state.value;
    if (
      !canRemoveStrongAuthFactor({
        role: user.role,
        removingTotp: true,
        removingPasskeys: false,
        hasTotp: strongAuthStatus.hasTotp,
        hasPasskey: strongAuthStatus.hasPasskey,
      })
    ) {
      return Err(fail("strong_method_required"));
    }

    return setup.uow.run(async (repos) => {
      await repos.userTotpFactors.disable(userId, disabledAt);
      if (!strongAuthStatus.hasPasskey) {
        await repos.userRecoveryCodes.deleteAllByAccount(userId);
      }
      await repos.events.append({
        workspaceId,
        type: "totp_disabled",
        entityType: "user",
        entityId: auditEntityId("user", userId),
        actorUserId: userId,
        occurredAt: disabledAt,
      });
      return Ok({ message: "Aplicación de autenticación desactivada" });
    });
  };

  return {
    login: {
      password: (
        input: Parameters<typeof submitPasswordLogin>[0],
        publicOrigin: string,
        operation: OperationContext,
      ) =>
        submitPasswordLogin(
          input,
          login,
          createPasskeyProviderForOrigin(login.repos, publicOrigin),
          operation,
        ),
      startPasskey: (
        input: Parameters<typeof startPasskeyLogin>[0],
        publicOrigin: string,
        operation: OperationContext,
      ) =>
        startPasskeyLogin(
          input,
          login,
          createPasskeyProviderForOrigin(login.repos, publicOrigin),
          operation,
        ),
      verifyTotp: (
        input: Parameters<typeof verifyTotpLoginProof>[1],
        operation: OperationContext,
      ) => verifyTotpLoginProof(login, input, operation),
      verifyRecovery: (
        input: Parameters<typeof verifyRecoveryLoginProof>[1],
        operation: OperationContext,
      ) => verifyRecoveryLoginProof(login, input, operation),
      verifyPasskey: (
        input: Omit<
          Parameters<typeof verifyPasskeyLogin>[1],
          "webauthnProvider"
        >,
        publicOrigin: string,
        operation: OperationContext,
      ) =>
        verifyPasskeyLogin(
          login.repos,
          {
            ...input,
            webauthnProvider: createPasskeyProviderForOrigin(
              login.repos,
              publicOrigin,
            ),
          },
          operation,
        ),
      complete: (
        input: Parameters<typeof completePendingLogin>[1],
        operation: OperationContext,
      ) => completePendingLogin(login, input, operation),
      completeGoogleOAuth: (
        input: Parameters<typeof completeGoogleOAuthCallback>[0],
        publicOrigin: string,
        operation: OperationContext,
      ) =>
        completeGoogleOAuthCallback(
          input,
          login,
          createPasskeyProviderForOrigin(login.repos, publicOrigin),
          operation,
        ),
      getFlow: (
        flowId: Parameters<typeof getLoginFlowState>[0],
        publicOrigin: string,
        operation: OperationContext,
      ) =>
        getLoginFlowState(
          flowId,
          login.repos,
          createPasskeyProviderForOrigin(login.repos, publicOrigin),
          operation,
        ),
    },
    sessions: {
      resolve: (token: string, operation: OperationContext) =>
        sessionAuthenticator.resolve(token, operation),
      currentUser: (ctx: AppContext) => getCurrentUser(ctx, sessionRead),
      logout: (ctx: AppContext) => logoutUser(ctx, sessionRevocation),
      listForUser: async (ctx: AppContext, input: { userId: UserId }) =>
        (await adminSessions.listForAccount(input.userId)).filter(
          (session) => session.workspace_id === ctx.actor.workspaceId,
        ),
      countActive: (ctx: AppContext) =>
        adminSessions.countActiveInWorkspace(
          ctx.actor.workspaceId,
          ctx.operationAt,
        ),
      listActive: (ctx: AppContext) =>
        listAllActiveSessions(
          adminSessions,
          (accountIds) =>
            workspaces.findPlacements(ctx.actor.workspaceId, accountIds),
          ctx.actor.workspaceId,
          ctx,
        ),
      revoke: (
        ctx: AppContext,
        input: Parameters<typeof revokeUserSession>[2],
      ) => revokeUserSession(ctx, sessionRevocation, input),
      revokeAll: (
        ctx: AppContext,
        input: Parameters<typeof revokeAllUserSessions>[2],
      ) => revokeAllUserSessions(ctx, sessionRevocation, input),
    },
    impersonation: {
      start: (ctx: AppContext, command: { userId: UserId }) =>
        impersonationUow.run((tx) => startImpersonation(ctx, tx, command)),
      stop: (ctx: AppContext) =>
        impersonationUow.run((tx) => stopImpersonation(ctx, tx)),
    },
    security: {
      changePassword: changeAccountPassword,
      removePasskeys: removeAccountPasskeys,
      disableTotp: disableAccountTotp,
      startPasskeyEnrollment: (ctx: AppContext) =>
        startPasskeyEnrollment(setup, {
          userId: ctx.actor.userId,
          ipAddress: ctx.ipAddress,
          occurredAt: ctx.operationAt,
          webauthnProvider: createPasskeyProviderForOrigin(
            setup.repos,
            ctx.publicOrigin,
          ),
        }),
      finishPasskeyEnrollment: (
        ctx: AppContext,
        input: Omit<
          Parameters<typeof verifyPasskeyEnrollment>[2],
          "userId" | "ipAddress" | "verifiedAt"
        >,
      ) =>
        verifyPasskeyEnrollment(
          setup.repos,
          createPasskeyProviderForOrigin(setup.repos, ctx.publicOrigin),
          {
            ...input,
            userId: ctx.actor.userId,
            ipAddress: ctx.ipAddress,
            verifiedAt: ctx.operationAt,
          },
        ).then(async (verified) =>
          verified.ok
            ? completeFactorEnrollment(ctx, setup, {
                method: "passkey",
                enrollment: verified.value,
              })
            : verified,
        ),
      startTotpEnrollment: (ctx: AppContext) => startTotpEnrollment(ctx, setup),
      finishTotpEnrollment: (ctx: AppContext, code: string) =>
        verifyTotpEnrollment(setup.repos, {
          userId: ctx.actor.userId,
          code,
        }).then(async (verified) =>
          verified.ok
            ? completeFactorEnrollment(ctx, setup, {
                method: "totp",
                enrollment: verified.value,
              })
            : verified,
        ),
    },
    onboarding: {
      saveProfile: (
        ctx: AppContext,
        phone: Parameters<typeof saveOnboardingProfile>[1]["phone"],
      ) =>
        saveOnboardingProfile(
          setup,
          {
            userId: ctx.actor.userId,
            workspaceId: ctx.actor.workspaceId,
            phone,
          },
          ctx,
        ),
      changePassword: (
        ctx: AppContext,
        input: Omit<Parameters<typeof changeInstallationPassword>[1], "userId">,
      ) =>
        changeInstallationPassword(
          setup,
          {
            ...input,
            userId: ctx.actor.userId,
          },
          ctx,
        ),
      snapshot: (member: { userId: UserId; workspaceId: WorkspaceId }) =>
        loadOnboardingSnapshot(setup, member),
      completeWithoutFactor: (ctx: AppContext) =>
        completeOnboarding(ctx, setup, { method: "none" }),
      completeWithTotp: (ctx: AppContext, code: string) =>
        verifyTotpEnrollment(setup.repos, {
          userId: ctx.actor.userId,
          code,
        }).then(async (verified) =>
          verified.ok
            ? completeOnboarding(ctx, setup, {
                method: "totp",
                enrollment: verified.value,
              })
            : verified,
        ),
      completeWithPasskey: (
        ctx: AppContext,
        input: Omit<
          Parameters<typeof verifyPasskeyEnrollment>[2],
          "userId" | "ipAddress" | "verifiedAt"
        >,
      ) =>
        verifyPasskeyEnrollment(
          setup.repos,
          createPasskeyProviderForOrigin(setup.repos, ctx.publicOrigin),
          {
            ...input,
            userId: ctx.actor.userId,
            ipAddress: ctx.ipAddress,
            verifiedAt: ctx.operationAt,
          },
        ).then(async (verified) =>
          verified.ok
            ? completeOnboarding(ctx, setup, {
                method: "passkey",
                enrollment: verified.value,
              })
            : verified,
        ),
    },
    recoveryCodes: {
      regenerate: (ctx: AppContext) => regenerateRecoverySetup(ctx, setup),
      acknowledge: (ctx: AppContext) => acknowledgeRecoverySetup(ctx, setup),
      status: async (userId: UserId) => {
        const active = await setup.repos.userRecoveryCodes.getActiveSet(userId);
        return {
          hasActiveSet: active !== null,
          total: active?.total ?? 0,
          unused: active?.unused ?? 0,
          acknowledged: active?.acknowledgedAt != null,
        };
      },
    },
    passwordReset: {
      request: (
        input: Omit<Parameters<typeof requestPasswordReset>[0], "deps">,
        operation: OperationContext,
      ) => requestPasswordReset({ ...input, deps: passwordReset }, operation),
      reset: (
        input: Omit<Parameters<typeof resetPassword>[0], "deps">,
        operation: OperationContext,
      ) => resetPassword({ ...input, deps: passwordReset }, operation),
    },
    invites: {
      acceptPassword: (
        input: Parameters<typeof submitInviteAcceptance>[2],
        request: Parameters<typeof submitInviteAcceptance>[1],
        operation: OperationContext,
      ) =>
        submitInviteAcceptance(
          {
            invites: deps.invites,
            repos: {
              users: setup.repos.users,
              sessions: setup.repos.sessions,
            },
          },
          request,
          input,
          operation,
        ),
    },
    admin: {
      loginRetries: async (username: string, ctx: AppContext) => {
        const { users, authEvents } = login.repos;
        const user = await users.findByUsername(
          username,
          ctx.actor.workspaceId,
        );
        if (!user) {
          return null;
        }

        const since = ctx.operationAt.getTime();
        const fifteenMinutesAgo = new Date(since - 15 * 60_000);
        const twentyFourHoursAgo = new Date(since - 24 * 60 * 60_000);
        const [retryCount15m, retryCount24h, recentRetries] = await Promise.all(
          [
            authEvents.countLoginRetriesSince(user.id, fifteenMinutesAgo),
            authEvents.countLoginRetriesSince(user.id, twentyFourHoursAgo),
            authEvents.findRecentLoginRetriesByAccount(user.id, 25),
          ],
        );

        return { user, retryCount15m, retryCount24h, recentRetries };
      },
    },
  };
}
