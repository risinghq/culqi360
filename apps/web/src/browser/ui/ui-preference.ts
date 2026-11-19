export type UiPreferenceCodec<T> = {
  decode: (raw: string) => T | null;
  encode: (value: T) => string;
};

export type UiPreference<T> = {
  read: () => T | null;
  write: (value: T) => void;
};

/**
 * A preference this browser keeps in localStorage. No server reads it. When
 * the browser blocks storage (a sandboxed frame, some private modes), `read`
 * returns null and the preference lasts only for the page.
 */
export function defineUiPreference<T>(
  key: string,
  codec: UiPreferenceCodec<T>,
): UiPreference<T> {
  return {
    read() {
      const raw = readStorage(key);
      return raw === null ? null : codec.decode(raw);
    },
    write(value) {
      writeStorage(key, codec.encode(value));
    },
  };
}

export const booleanCodec: UiPreferenceCodec<boolean> = {
  decode: (raw) => (raw === "true" ? true : raw === "false" ? false : null),
  encode: String,
};

export function oneOfCodec<T extends string>(
  values: readonly T[],
): UiPreferenceCodec<T> {
  return {
    decode: (raw) => values.find((value) => value === raw) ?? null,
    encode: (value) => value,
  };
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the value lives in the caller's signal until reload.
  }
}
