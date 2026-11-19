import { sha256 } from "@oslojs/crypto/sha2";
import {
  encodeBase32LowerCaseNoPadding,
  encodeHexLowerCase,
} from "@oslojs/encoding";

import type { WorkspaceId } from "~/domain/ids";
import {
  openWorkspaceToken,
  sealWorkspaceToken,
} from "~/server/security/workspace-token";

const SECRET_RE = /^[a-z2-7]{32}$/;

// The cookie names the workspace that holds the session around 20 random
// bytes. The store keeps the SHA-256 of the whole token, so a leaked sessions
// table cannot forge cookies.
export function generateSessionToken(workspaceId: WorkspaceId): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return sealSessionToken(workspaceId, encodeBase32LowerCaseNoPadding(bytes));
}

// Seals a chosen 32-character base32 secret. Seed tools use it for sessions
// whose cookie must stay the same across reseeds.
export function sealSessionToken(
  workspaceId: WorkspaceId,
  secret: string,
): string {
  if (!SECRET_RE.test(secret)) {
    throw new Error("session secret must be 32 base32 characters");
  }
  return sealWorkspaceToken(workspaceId, secret);
}

export function hashSessionToken(token: string): string {
  return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

// The workspace whose store holds the token's session, or null for a token
// this server did not issue.
export function sessionTokenWorkspace(token: string): WorkspaceId | null {
  const opened = openWorkspaceToken(token);
  return opened && SECRET_RE.test(opened.body) ? opened.workspaceId : null;
}
