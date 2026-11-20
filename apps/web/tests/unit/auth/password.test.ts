import { describe, expect, it } from "vitest";

import {
  hashPassword,
  UNUSABLE_PASSWORD_HASH,
  verifyPassword,
} from "~/server/auth/password/password";

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function hashAt(
  password: string,
  iterations: number,
  salt = new Uint8Array(16).fill(7),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return `pbkdf2-sha256$${iterations}$${base64Url(salt)}$${base64Url(new Uint8Array(bits))}`;
}

describe("password hashing", () => {
  it("verifies the password it hashed and rejects another", async () => {
    const hash = await hashPassword("correct horse");

    expect(hash).toMatch(/^pbkdf2-sha256\$100000\$[\w-]{22}\$[\w-]{43}$/);
    await expect(verifyPassword(hash, "correct horse")).resolves.toBe(true);
    await expect(verifyPassword(hash, "correct horsE")).resolves.toBe(false);
  });

  it("salts each hash", async () => {
    const [first, second] = await Promise.all([
      hashPassword("same"),
      hashPassword("same"),
    ]);

    expect(first).not.toBe(second);
  });

  it("verifies a hash at its own iteration count", async () => {
    const hash = await hashAt("older", 1_000);

    await expect(verifyPassword(hash, "older")).resolves.toBe(true);
    await expect(verifyPassword(hash, "newer")).resolves.toBe(false);
  });

  it.each([
    UNUSABLE_PASSWORD_HASH,
    "",
    "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$a2V5",
    "pbkdf2-sha256$abc$AAAA$AAAA",
    "pbkdf2-sha256$0$AAAA$AAAA",
    "pbkdf2-sha256$100001$AAAA$AAAA",
    "pbkdf2-sha256$1000$AAAA",
    "pbkdf2-sha256$1000$AAAA$AAAA$AAAA",
    "pbkdf2-sha256$1000$!!!!$AAAA",
  ])("rejects every password against %j", async (hash) => {
    await expect(verifyPassword(hash, "")).resolves.toBe(false);
    await expect(verifyPassword(hash, "!")).resolves.toBe(false);
  });
});
