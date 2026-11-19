import { createSignal } from "solid-js";

import { defineUiPreference, oneOfCodec } from "~/browser/ui/ui-preference";

type AuthMethod = "google" | "password" | "passkey";

const lastUsedMethodPreference = defineUiPreference(
  "last_auth_method",
  oneOfCodec<AuthMethod>(["google", "password", "passkey"]),
);

export function useLoginFlow() {
  const [lastUsedMethod, setLastUsedMethod] = createSignal<AuthMethod | null>(
    lastUsedMethodPreference.read(),
  );

  function markUsed(method: AuthMethod): void {
    lastUsedMethodPreference.write(method);
    setLastUsedMethod(method);
  }

  return {
    lastUsedMethod,
    markUsed,
  };
}
