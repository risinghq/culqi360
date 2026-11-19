import { EXTENSION_HANDOFF_TOKEN_ISSUER } from "@crm/contracts/extension";

import type { WorkspaceId } from "~/domain/ids";
import {
  addMilliseconds,
  epochMilliseconds,
  epochSeconds,
} from "~/domain/time/clock";

import { EXTENSION_SESSION_TOKEN_AUDIENCE } from "../contracts";
import {
  generateExtensionRefreshToken,
  hashExtensionSecretToken,
  signExtensionToken,
} from "../crypto";
import type { ExtensionRuntimeRepo } from "../repos";

const EXTENSION_INSTALLATION_SESSION_TTL_MS = 8 * 60 * 60_000;
const EXTENSION_ACCESS_TOKEN_TTL_MS = 15 * 60_000;

export type InstallationSessionRecord = Omit<
  NonNullable<
    Awaited<ReturnType<ExtensionRuntimeRepo["findValidInstallationSession"]>>
  >,
  "workspace_id"
>;

export interface SessionCredentials {
  refreshToken: string;
  refreshTokenHash: string;
  sessionToken: string;
  expiresAt: number;
}

function accessTokenExpiresAt(issuedAt: Date): Date {
  return addMilliseconds(issuedAt, EXTENSION_ACCESS_TOKEN_TTL_MS);
}

export function installationSessionExpiresAt(issuedAt: Date): Date {
  return addMilliseconds(issuedAt, EXTENSION_INSTALLATION_SESSION_TTL_MS);
}

async function signInstallationSessionToken(
  workspaceId: WorkspaceId,
  session: InstallationSessionRecord,
  issuedAt: Date,
): Promise<string> {
  const accessExpiresAt = accessTokenExpiresAt(issuedAt);

  return signExtensionToken({
    iss: EXTENSION_HANDOFF_TOKEN_ISSUER,
    aud: EXTENSION_SESSION_TOKEN_AUDIENCE,
    sub: `user:${session.user_id}`,
    workspaceId,
    authSessionId: session.auth_session_id,
    branchId: session.branch_id,
    installationId: session.installation_id,
    jti: session.jti,
    iat: epochSeconds(issuedAt),
    exp: epochSeconds(accessExpiresAt),
  });
}

export async function issueSessionCredentials(
  workspaceId: WorkspaceId,
  session: InstallationSessionRecord,
  issuedAt: Date,
): Promise<SessionCredentials> {
  const refreshToken = generateExtensionRefreshToken(workspaceId);
  const refreshTokenHash = await hashExtensionSecretToken(refreshToken);
  const expiresAt = accessTokenExpiresAt(issuedAt);

  return {
    refreshToken,
    refreshTokenHash,
    sessionToken: await signInstallationSessionToken(
      workspaceId,
      session,
      issuedAt,
    ),
    expiresAt: epochMilliseconds(expiresAt),
  };
}
