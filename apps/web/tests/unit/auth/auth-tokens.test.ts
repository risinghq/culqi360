import { describe, expect, it } from "vitest";

import { WorkspaceId } from "~/domain/ids";
import {
  generateSessionToken,
  hashSessionToken,
  sealSessionToken,
  sessionTokenWorkspace,
} from "~/server/auth/session/tokens";

const WORKSPACE = WorkspaceId.trust("0e2e0000-0000-7000-8000-00000000c0de");
const OTHER = WorkspaceId.trust("0e2e0000-0000-7000-8000-00000000beef");

describe("session tokens", () => {
  it("names the workspace that issued it", () => {
    const token = generateSessionToken(WORKSPACE);

    expect(token).toMatch(/^[^.]+\.[a-z2-7]{32}\.[a-z2-7]+$/);
    expect(sessionTokenWorkspace(token)).toBe(WORKSPACE);
  });

  it("rejects a token whose workspace id was swapped", () => {
    const token = generateSessionToken(WORKSPACE);
    const forged = token.replace(WORKSPACE, OTHER);

    expect(sessionTokenWorkspace(forged)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(sessionTokenWorkspace("short")).toBeNull();
    expect(sessionTokenWorkspace("a".repeat(32))).toBeNull();
    expect(sessionTokenWorkspace(`${WORKSPACE}.${"a".repeat(32)}.`)).toBeNull();
    expect(() => sealSessionToken(WORKSPACE, "A".repeat(32))).toThrow(
      "session secret must be 32 base32 characters",
    );
  });

  it("seals a chosen secret to the same token every time", () => {
    const secret = "a234567a234567a234567a234567a234";

    expect(sealSessionToken(WORKSPACE, secret)).toBe(
      sealSessionToken(WORKSPACE, secret),
    );
  });

  it("hash is deterministic and non-reversible in shape", () => {
    const token = "a234567a234567a234567a234567a23";
    const hash1 = hashSessionToken(token);
    const hash2 = hashSessionToken(token);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    expect(hash1).not.toContain(token);
    expect(hash1).toBe(
      "20d053ea3932fc0f863a19fd77994b9b371fdd18b841aefee1ec4e844a4c9b90",
    );
  });
});
