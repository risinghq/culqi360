import { isPlainRecord } from "~/shared/type-guards";

const AUTH_FUNNEL_SCREENS = [
  "login",
  "login_verify",
  "login_passkey",
  "reset_password",
] as const;

export type AuthFunnelScreen = (typeof AUTH_FUNNEL_SCREENS)[number];

/** What the browser reports about the sign-in funnel; the server trusts nothing else. */
export type AuthFunnelClientEventPayload =
  | {
      kind: "screen_viewed";
      screen: AuthFunnelScreen;
    }
  | {
      kind: "passkey_result";
      outcome: "failed";
      code: "cancelled" | "unsupported" | "server_error";
    };

function isAuthFunnelScreen(value: unknown): value is AuthFunnelScreen {
  return (
    typeof value === "string" &&
    AUTH_FUNNEL_SCREENS.some((screen) => screen === value)
  );
}

export function readAuthFunnelClientEvent(
  input: unknown,
): AuthFunnelClientEventPayload | null {
  if (!isPlainRecord(input)) {
    return null;
  }

  if (input.kind === "screen_viewed" && isAuthFunnelScreen(input.screen)) {
    return {
      kind: "screen_viewed",
      screen: input.screen,
    };
  }

  if (
    input.kind === "passkey_result" &&
    input.outcome === "failed" &&
    (input.code === "cancelled" ||
      input.code === "unsupported" ||
      input.code === "server_error")
  ) {
    return {
      kind: "passkey_result",
      outcome: "failed",
      code: input.code,
    };
  }

  return null;
}
