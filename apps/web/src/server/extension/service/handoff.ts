import {
  EXTENSION_HANDOFF_TOKEN_AUDIENCE,
  EXTENSION_HANDOFF_TOKEN_ISSUER,
  isExtensionHandoffClaims,
  type ClaimExtensionSessionResponse,
} from "@crm/contracts/extension";

import { external, fail, invalid, type DomainError } from "~/domain/errors";
import { InstallationId } from "~/domain/ids";
import type {
  BranchId,
  CampaignRecordId,
  CaseId,
  ContactId,
  UserId,
  WorkspaceId,
} from "~/domain/ids";
import {
  addMilliseconds,
  epochMilliseconds,
  epochSeconds,
} from "~/domain/time/clock";
import {
  subjectColumns,
  type ActivitySubject,
} from "~/server/activities/domain/activity-subject";
import type { CallTarget } from "~/server/calls/domain/call-target";
import { extensionConfig } from "~/server/platform/config/env";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, isErr, type Result } from "~/shared/result";

import { type CreateExtensionHandoffTokenResponse } from "../contracts";
import { signExtensionToken, verifyExtensionToken } from "../crypto";
import { upsertSyncHealth } from "./presence";
import { type ExtensionRepos, hasActiveAuthSession } from "./shared";
import {
  type InstallationSessionRecord,
  type SessionCredentials,
  installationSessionExpiresAt,
  issueSessionCredentials,
} from "./tokens";
import {
  isCryptoMisconfiguration,
  isInvalidExtensionToken,
  isTokenExpired,
  parseSubjectUserId,
} from "./validators";

const EXTENSION_HANDOFF_TTL_MS = 120_000;

function handoffSubject(handoff: {
  campaign_record_id: CampaignRecordId | null;
  case_id: CaseId | null;
  contact_id: ContactId | null;
}): ActivitySubject | null {
  if (handoff.campaign_record_id !== null) {
    return {
      kind: "campaign_record",
      campaignRecordId: handoff.campaign_record_id,
    };
  }
  if (handoff.case_id !== null) {
    return { kind: "case", caseId: handoff.case_id };
  }
  if (handoff.contact_id !== null) {
    return { kind: "contact", contactId: handoff.contact_id };
  }
  return null;
}

interface HandoffMethodContext extends OperationContext {
  workspaceId: WorkspaceId;
  repos: ExtensionRepos;
  uow: AppUow<ExtensionRepos>;
}

// The target is resolved and authorized by the caller; this only signs it
// and records the handoff the claim will check against.
export async function createHandoffToken(
  context: HandoffMethodContext,
  input: {
    userId: UserId;
    authSessionId: string;
    branchId: BranchId;
    target: CallTarget;
    origin: string;
  },
): Promise<Result<CreateExtensionHandoffTokenResponse, DomainError>> {
  const { repos } = context;
  const { target } = input;

  if (!input.origin) {
    return Err(invalid({ code: "origin_required" }));
  }

  const expectedOrigin = extensionConfig().extensionExpectedOrigin;

  if (input.origin !== expectedOrigin) {
    return Err(fail("handoff_origin_not_allowed"));
  }

  try {
    const issuedAt = context.operationAt;
    const handoffExpiresAt = addMilliseconds(
      issuedAt,
      EXTENSION_HANDOFF_TTL_MS,
    );
    const handoffJti = crypto.randomUUID();

    const handoffToken = await signExtensionToken({
      iss: EXTENSION_HANDOFF_TOKEN_ISSUER,
      aud: EXTENSION_HANDOFF_TOKEN_AUDIENCE,
      sub: `user:${input.userId}`,
      workspaceId: context.workspaceId,
      authSessionId: input.authSessionId,
      branchId: input.branchId,
      organizationId: target.organizationId,
      phone: target.phone,
      clientName: target.clientName,
      organizationLabel: target.organizationLabel,
      action: "start_call",
      origin: input.origin,
      jti: handoffJti,
      iat: epochSeconds(issuedAt),
      exp: epochSeconds(handoffExpiresAt),
    });

    await repos.extensionRuntime.createHandoff({
      jti: handoffJti,
      user_id: input.userId,
      branch_id: input.branchId,
      auth_session_id: input.authSessionId,
      ...subjectColumns(target.subject),
      organization_id: target.organizationId,
      phone: target.phone,
      issued_at: issuedAt,
      expires_at: handoffExpiresAt,
      origin: input.origin,
    });

    return Ok({
      handoffToken,
      expiresAt: epochMilliseconds(handoffExpiresAt),
    });
  } catch (error: unknown) {
    if (isCryptoMisconfiguration(error)) {
      return Err(
        external("Extension token keys are not configured", {
          code: "misconfigured",
        }),
      );
    }

    return Err(
      external(
        error instanceof Error
          ? error.message
          : "Unexpected extension handoff failure",
        { code: "unexpected" },
      ),
    );
  }
}

export async function claimInstallationSession(
  context: HandoffMethodContext,
  input: {
    handoffToken: string;
    installationId: string;
  },
): Promise<Result<ClaimExtensionSessionResponse, DomainError>> {
  const { uow } = context;

  const installationId = InstallationId.parse(input.installationId);
  if (isErr(installationId)) {
    return Err(invalid({ code: "installation_invalid" }));
  }

  try {
    const claimedAt = context.operationAt;
    const handoffClaims = await verifyExtensionToken(
      input.handoffToken,
      isExtensionHandoffClaims,
    );

    if (isTokenExpired(handoffClaims.exp, claimedAt)) {
      return Err(fail("handoff_invalid"));
    }

    const userId = parseSubjectUserId(handoffClaims.sub);

    if (!userId) {
      return Err(fail("handoff_invalid"));
    }

    const claimResult = await uow.run(async (txRepos) => {
      const handoff = await txRepos.extensionRuntime.lockHandoff(
        handoffClaims.jti,
      );

      if (
        !handoff ||
        handoff.expires_at <= claimedAt ||
        handoff.origin !== handoffClaims.origin ||
        handoff.user_id !== userId ||
        handoff.branch_id !== handoffClaims.branchId ||
        handoff.auth_session_id !== handoffClaims.authSessionId ||
        handoff.organization_id !== handoffClaims.organizationId ||
        handoff.phone !== handoffClaims.phone
      ) {
        return Err(fail("handoff_invalid"));
      }

      const authSessionActive = await hasActiveAuthSession(
        txRepos,
        handoff.auth_session_id,
        claimedAt,
      );

      if (!authSessionActive) {
        return Err(fail("handoff_invalid"));
      }

      let session: InstallationSessionRecord;
      let sessionCredentials: SessionCredentials | null = null;

      if (handoff.consumed_at !== null) {
        if (
          handoff.installation_id !== installationId.value ||
          !handoff.installation_session_jti
        ) {
          return Err(fail("handoff_claimed_by_other_installation"));
        }

        const existingSession =
          await txRepos.extensionRuntime.findValidInstallationSession(
            handoff.installation_session_jti,
            claimedAt,
          );

        if (!existingSession) {
          return Err(fail("handoff_invalid"));
        }

        session = existingSession;
      } else {
        const reusableSession =
          await txRepos.extensionRuntime.findActiveInstallationSession(
            handoff.auth_session_id,
            installationId.value,
            claimedAt,
          );
        const sessionJti = reusableSession?.jti ?? crypto.randomUUID();

        const consumeResult = await txRepos.extensionRuntime.consumeHandoff({
          jti: handoff.jti,
          installation_id: installationId.value,
          installation_session_jti: sessionJti,
          consumed_at: claimedAt,
        });

        if (Number(consumeResult.numUpdatedRows ?? 0) === 0) {
          const racedHandoff = await txRepos.extensionRuntime.findHandoffByJti(
            handoff.jti,
          );

          if (
            !racedHandoff ||
            racedHandoff.installation_id !== installationId.value ||
            !racedHandoff.installation_session_jti
          ) {
            return Err(fail("handoff_claimed_by_other_installation"));
          }

          const racedSession =
            await txRepos.extensionRuntime.findValidInstallationSession(
              racedHandoff.installation_session_jti,
              claimedAt,
            );

          if (!racedSession) {
            return Err(fail("handoff_invalid"));
          }

          session = racedSession;
        } else if (reusableSession) {
          session = reusableSession;
        } else {
          const newSession = {
            jti: sessionJti,
            user_id: handoff.user_id,
            branch_id: handoff.branch_id,
            auth_session_id: handoff.auth_session_id,
            installation_id: installationId.value,
            refresh_token_hash: "",
            issued_at: claimedAt,
            expires_at: installationSessionExpiresAt(claimedAt),
            revoked_at: null,
            last_seen_at: null,
            refreshed_at: claimedAt,
          } satisfies InstallationSessionRecord;

          sessionCredentials = await issueSessionCredentials(
            context.workspaceId,
            newSession,
            claimedAt,
          );

          await txRepos.extensionRuntime.createInstallationSession({
            jti: newSession.jti,
            user_id: newSession.user_id,
            branch_id: newSession.branch_id,
            auth_session_id: newSession.auth_session_id,
            installation_id: newSession.installation_id,
            refresh_token_hash: sessionCredentials.refreshTokenHash,
            issued_at: newSession.issued_at,
            expires_at: newSession.expires_at,
          });

          session = {
            ...newSession,
            refresh_token_hash: sessionCredentials.refreshTokenHash,
          };
        }
      }

      await txRepos.extensionRuntime.revokeOtherInstallationSessionsByUser(
        session.user_id,
        session.jti,
        claimedAt,
      );

      if (sessionCredentials === null) {
        sessionCredentials = await issueSessionCredentials(
          context.workspaceId,
          session,
          claimedAt,
        );

        await txRepos.extensionRuntime.rotateInstallationSessionRefreshToken({
          jti: session.jti,
          refresh_token_hash: sessionCredentials.refreshTokenHash,
          refreshed_at: claimedAt,
          expires_at: installationSessionExpiresAt(claimedAt),
        });
      }

      await upsertSyncHealth(txRepos.extensionRuntime, {
        userId: session.user_id,
        branchId: session.branch_id,
        syncHealth: "ok",
        updatedAt: claimedAt,
      });

      let callId = handoff.call_id;
      if (callId === null) {
        callId = await txRepos.activities.create({
          channel: "call",
          userId: handoff.user_id,
          branchId: handoff.branch_id,
          organizationId: handoff.organization_id,
          subject: handoffSubject(handoff),
          phone: handoff.phone,
          source: "extension",
          startedAt: claimedAt,
        });
        await txRepos.extensionRuntime.attachCall(handoff.jti, callId);
      }

      return Ok({
        sessionToken: sessionCredentials.sessionToken,
        refreshToken: sessionCredentials.refreshToken,
        expiresAt: sessionCredentials.expiresAt,
        callId,
      });
    });

    return claimResult;
  } catch (error: unknown) {
    if (isCryptoMisconfiguration(error)) {
      return Err(
        external("Extension token keys are not configured", {
          code: "misconfigured",
        }),
      );
    }

    if (isInvalidExtensionToken(error)) {
      return Err(fail("handoff_invalid"));
    }

    return Err(
      external(
        error instanceof Error
          ? error.message
          : "Unexpected extension session claim failure",
        { code: "unexpected" },
      ),
    );
  }
}
