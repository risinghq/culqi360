// PBKDF2-SHA256 through WebCrypto, which Bun and Workers both run natively.
// A hash reads `pbkdf2-sha256$<iterations>$<salt>$<key>` in base64url, so
// raising the cost leaves stored hashes verifiable at their own count.
//
// Workers cap PBKDF2 at 100,000 iterations, so a new hash uses the cap.
const ALGORITHM = "pbkdf2-sha256";
const MAX_ITERATIONS = 100_000;
const ITERATIONS = MAX_ITERATIONS;
const SALT_BYTES = 16;
const KEY_BITS = 256;

const encoder = new TextEncoder();

type Bytes = Uint8Array<ArrayBuffer>;

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Bytes {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function derive(
  password: string,
  salt: Bytes,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await derive(password, salt, ITERATIONS);
  return [ALGORITHM, ITERATIONS, toBase64Url(salt), toBase64Url(key)].join("$");
}

// A hash no password matches: an account that must reset its password, and
// the stand-in a login checks for an unknown username.
export const UNUSABLE_PASSWORD_HASH = "!";

const UNUSABLE_SALT = new Uint8Array(SALT_BYTES);

function parse(
  passwordHash: string,
): { salt: Bytes; key: Bytes; iterations: number } | null {
  const [algorithm, count, salt, key, ...rest] = passwordHash.split("$");
  const iterations = Number(count);
  if (
    algorithm !== ALGORITHM ||
    salt === undefined ||
    key === undefined ||
    rest.length > 0 ||
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > MAX_ITERATIONS
  ) {
    return null;
  }
  try {
    return { salt: fromBase64Url(salt), key: fromBase64Url(key), iterations };
  } catch {
    return null;
  }
}

// An unusable or malformed hash costs a full derivation and fails, so a
// login's timing does not tell whether the username exists.
export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  const stored = parse(passwordHash);
  if (!stored) {
    await derive(password, UNUSABLE_SALT, ITERATIONS);
    return false;
  }
  const key = await derive(password, stored.salt, stored.iterations);
  return equalBytes(key, stored.key);
}
