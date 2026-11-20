import type { UserId } from "~/domain/ids";
import type {
  SubmitPrimaryLoginError,
  SubmitPrimaryLoginResult,
  TotpLoginFlowState,
} from "~/server/auth/application/login-contracts";
import { createAuthThrottleService } from "~/server/auth/application/throttle-service";
import { AUTH_LOGIN_FLOW_TTL_MS } from "~/server/auth/config";
import type { AuthContext } from "~/server/auth/context/auth-context";
import type { WebauthnProvider } from "~/server/auth/factors/passkey-provider";
import {
  persistPasskeyLoginFlow,
  preparePasskeyLogin,
  type PreparedPasskeyLogin,
} from "~/server/auth/factors/passkey/service";
import type { AuthLoginRepos } from "~/server/auth/flows/login-deps";
import type { AuthLoginContext } from "~/server/auth/infrastructure/login-context";
import { evaluateLoginPolicy } from "~/server/auth/policy/engine";
import type { AuthProof } from "~/server/auth/policy/types";
import { recordAuthEvent } from "~/server/auth/security/auth-events";
import { loginSourceAudit } from "~/server/auth/security/login-source-audit";
import type {
  MintedSession,
  SessionRequestMetadata,
} from "~/server/auth/session/session-spec";
import {
  mintLogin,
  openMintedSession,
} from "~/server/auth/session/session.service";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, isErr, Ok, type Result } from "~/shared/result";

async function createTotpLoginFlow(
  identifier: string,
  userId: UserId,
  primaryAuthMethod: "password" | "google" | "passkey",
  occurredAt: Date,
  deps: Pick<AuthLoginRepos, "loginFlows">,
): Promise<TotpLoginFlowState> {
  const flowId = await deps.loginFlows.create({
    identifier,
    primary_auth_method: primaryAuthMethod,
    account_id: userId,
    challenge_id: null,
    state: "totp",
    expires_at: new Date(occurredAt.getTime() + AUTH_LOGIN_FLOW_TTL_MS),
    created_at: occurredAt,
  });

  return {
    id: flowId,
    identifier,
    state: "totp",
  };
}

export async function completePrimaryAuthProof(params: {
  proof: AuthProof;
  identifier: string;
  request: SessionRequestMetadata;
  context: AuthContext;
  deps: AuthLoginContext;
  webauthnProvider: WebauthnProvider;
  operation: OperationContext;
}): Promise<Result<SubmitPrimaryLoginResult, SubmitPrimaryLoginError>> {
  const authenticatedAt = params.operation.operationAt;
  const decision = evaluateLoginPolicy({
    proof: params.proof,
    context: params.context,
    provedAt: authenticatedAt,
  });

  if (decision.kind === "deny") {
    return Err({ kind: decision.reason });
  }

  let preparedPasskey: PreparedPasskeyLogin | null = null;
  if (decision.kind === "require_passkey") {
    const prepared = await preparePasskeyLogin(
      params.deps.repos,
      params.webauthnProvider,
      {
        identifier: params.identifier,
        ipAddress: params.request.ipAddress,
        mode: "identified",
        primaryAuthMethod: params.proof.kind,
        occurredAt: authenticatedAt,
        account: { kind: "authenticated", user: params.context.user },
      },
    );
    if (isErr(prepared)) {
      return Err({ kind: "invalid_credentials" });
    }
    preparedPasskey = prepared.value;
  }

  let minted = undefined as MintedSession | undefined;
  const result = await params.deps.uow.run<
    SubmitPrimaryLoginResult,
    SubmitPrimaryLoginError
  >(async (repos) => {
    if (params.proof.kind === "password") {
      await createAuthThrottleService({
        authThrottle: repos.authThrottle,
      }).clearLoginFailureState(params.identifier, params.request.ipAddress);
      await recordAuthEvent(repos, {
        userId: params.context.user.id,
        identifier: params.identifier,
        ipAddress: params.request.ipAddress,
        method: "password",
        stage: "login",
        outcome: "success",
        occurredAt: authenticatedAt,
      });
    }

    if (decision.kind === "require_totp") {
      return Ok({
        kind: "totp_required",
        flow: await createTotpLoginFlow(
          params.identifier,
          params.context.user.id,
          params.proof.kind,
          authenticatedAt,
          repos,
        ),
      });
    }

    if (decision.kind === "require_passkey") {
      if (!preparedPasskey) {
        return Err({ kind: "invalid_credentials" });
      }
      const flow = await persistPasskeyLoginFlow(repos, preparedPasskey);
      return Ok({ kind: "passkey_required", flow });
    }

    minted = mintLogin(
      {
        user: params.context.user,
        sessionClass: decision.sessionClass,
        request: params.request,
        primaryAuthMethod: params.proof.kind,
        strongAuthMethod: decision.strongAuthMethod,
        strongAuthAt: decision.strongAuthAt,
      },
      params.operation,
    );
    return Ok({
      kind: "complete",
      result: {
        userId: params.context.user.id,
        role: params.context.user.role,
        sessionClass: decision.sessionClass,
        token: minted.token,
      },
    });
  });

  if (!isErr(result) && minted) {
    await openMintedSession(
      params.deps.workspaces,
      minted,
      loginSourceAudit({
        user: params.context.user,
        ipAddress: params.request.ipAddress,
        method: params.proof.kind,
        occurredAt: authenticatedAt,
      }),
    );
  }
  return result;
}
