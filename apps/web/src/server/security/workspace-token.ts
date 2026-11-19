import { hmac } from "@oslojs/crypto/hmac";
import { SHA256 } from "@oslojs/crypto/sha2";
import { constantTimeEqual } from "@oslojs/crypto/subtle";
import { encodeBase32LowerCaseNoPadding } from "@oslojs/encoding";

import type { WorkspaceId } from "~/domain/ids";
import { WorkspaceId as WorkspaceIdCodec } from "~/domain/ids";
import { sessionConfig } from "~/server/platform/config/env";

const TAG_BYTES = 16;
const encoder = new TextEncoder();

export interface WorkspaceToken {
  workspaceId: WorkspaceId;
  body: string;
}

function tag(signed: string): string {
  const key = encoder.encode(sessionConfig().sessionSecret);
  const mac = hmac(SHA256, key, encoder.encode(signed));
  return encodeBase32LowerCaseNoPadding(mac.subarray(0, TAG_BYTES));
}

// A credential that names the workspace store holding its record, as
// `<workspaceId>.<body>.<tag>`. The tag is an HMAC of the rest under
// SESSION_SECRET, so a request routes on the workspace id without reading a
// store, and a forged id is rejected before any store opens.
export function sealWorkspaceToken(
  workspaceId: WorkspaceId,
  body: string,
): string {
  const signed = `${workspaceId}.${body}`;
  return `${signed}.${tag(signed)}`;
}

export function openWorkspaceToken(token: string): WorkspaceToken | null {
  const first = token.indexOf(".");
  const last = token.lastIndexOf(".");
  if (first <= 0 || last <= first + 1) {
    return null;
  }

  const workspaceId = WorkspaceIdCodec.parse(token.slice(0, first));
  if (!workspaceId.ok) {
    return null;
  }

  const signed = token.slice(0, last);
  const expected = encoder.encode(tag(signed));
  const actual = encoder.encode(token.slice(last + 1));
  if (!constantTimeEqual(expected, actual)) {
    return null;
  }

  return { workspaceId: workspaceId.value, body: token.slice(first + 1, last) };
}
