import { expectErr } from "@tests/support/_core/assertions";
import { createAuthScenario } from "@tests/support/auth/scenario";
import { getSeededIdentity } from "@tests/support/identities/api";
import { operationAt } from "@tests/support/operation";
import {
  buildAssertionResponse,
  createAuthFlow,
  createTestPasskeyProvider,
} from "@tests/support/passkey/api";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  persistPasskeyLoginFlow,
  preparePasskeyLogin,
  verifyPasskeyLogin,
} from "~/server/auth/factors/passkey/service";
import { completePendingLogin } from "~/server/auth/flows/complete-pending-login";
import { startPasskeyLogin } from "~/server/auth/flows/start-passkey-login";
import { createAuthLoginContext } from "~/server/auth/infrastructure/login-context";
import { isErr } from "~/shared/result";

describe("passkey error mapping", () => {
  const scenario = createAuthScenario("passkey-error-mapping");
  const ipAddress = "198.51.100.66";
  const execOne = getSeededIdentity("execOne");

  function loginContext() {
    return createAuthLoginContext(
      scenario.ctx.platform,
      scenario.ctx.authWorkspaces,
    );
  }

  beforeAll(async () => {
    await scenario.setup();
  });

  afterAll(async () => {
    await scenario.teardown();
  });

  beforeEach(async () => {
    await scenario.reset();
  });

  it("returns invalid credentials for empty identifier", async () => {
    const login = loginContext();

    const result = await startPasskeyLogin(
      { identifier: "   ", ipAddress, mode: "identified" },
      login,
      createTestPasskeyProvider(login.repos),
      operationAt(new Date()),
    );

    const error = expectErr(result);

    expect(error.kind).toBe("invalid_credentials");
  });

  it("throws when login flow persistence fails", async () => {
    await scenario.ctx.repos.passkeys.create({
      id: "pk-login-failure",
      account_id: execOne.userId,
      public_key: "base64-public-key",
      counter: 0,
      transports: JSON.stringify(["internal"]),
      created_at: new Date(),
    });

    const { repos } = loginContext();
    const prepared = await preparePasskeyLogin(
      repos,
      createTestPasskeyProvider(repos),
      {
        identifier: "exec.one",
        ipAddress,
        mode: "identified",
        occurredAt: new Date(),
        account: { kind: "lookup" },
      },
    );

    if (isErr(prepared)) {
      throw new Error("expected prepared passkey login");
    }

    await expect(
      persistPasskeyLoginFlow(
        {
          ...repos,
          loginFlows: {
            ...repos.loginFlows,
            async create() {
              throw new Error("boom");
            },
          },
        },
        prepared.value,
      ),
    ).rejects.toThrow("boom");
  });

  it("maps invalid assertion to invalid credentials and records telemetry", async () => {
    const { challengeId, flowId } = await createAuthFlow({
      ctx: scenario.ctx,
      userId: execOne.userId,
      challenge: "challenge-1",
    });

    const login = loginContext();
    const operation = operationAt(new Date());

    const verified = await verifyPasskeyLogin(
      login.repos,
      {
        flowId,
        response: buildAssertionResponse("missing-passkey"),
        ipAddress,
        webauthnProvider: createTestPasskeyProvider(login.repos),
      },
      operation,
    );

    const result = isErr(verified)
      ? verified
      : await completePendingLogin(
          login,
          {
            proof: verified.value,
            ipAddress,
            userAgent: "vitest-agent",
          },
          operation,
        );

    const error = expectErr(result);

    expect(error.kind).toBe("invalid_credentials");

    const challenge =
      await scenario.ctx.repos.webauthnChallenges.findById(challengeId);

    expect(challenge).toBeUndefined();

    const recentRetries =
      await scenario.ctx.repos.authEvents.findRecentLoginRetriesByAccount(
        execOne.userId,
        5,
      );

    expect(recentRetries[0]?.method).toBe("passkey");
    expect(recentRetries[0]?.stage).toBe("verify");
    expect(recentRetries[0]?.outcome).toBe("failure");
    expect(recentRetries[0]?.reason).toBe("assertion_invalid");
  });
});
