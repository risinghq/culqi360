import { describe, expect, it } from "vitest";

import { readAuthFunnelClientEvent } from "~/domain/observability/auth-funnel";

describe("readAuthFunnelClientEvent", () => {
  it.each([
    null,
    [],
    {},
    { kind: "screen_viewed", screen: "unknown" },
    { kind: "passkey_result", outcome: "succeeded" },
    { kind: "passkey_result", outcome: "failed", code: "anything" },
  ])("rejects %j", (input) => {
    expect(readAuthFunnelClientEvent(input)).toBeNull();
  });

  it("keeps only the fields the server knows", () => {
    expect(
      readAuthFunnelClientEvent({
        kind: "passkey_result",
        outcome: "failed",
        code: "cancelled",
        untrustedField: "ignored",
      }),
    ).toEqual({ kind: "passkey_result", outcome: "failed", code: "cancelled" });

    expect(
      readAuthFunnelClientEvent({
        kind: "screen_viewed",
        screen: "login_verify",
        source: "server",
      }),
    ).toEqual({ kind: "screen_viewed", screen: "login_verify" });
  });
});
