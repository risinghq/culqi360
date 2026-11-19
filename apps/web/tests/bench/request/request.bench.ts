import { operationAt } from "@tests/support/operation";
import { beforeAll, describe, expect, test } from "vitest";

import { createHost, type Host } from "~/server/composition/host";
import { isErr } from "~/shared/result";

import { BENCH_NOW } from "../_shared/constants";
import {
  BENCH_PASSWORD,
  createBenchHost,
  type BenchHost,
} from "../_shared/host";

const ORIGIN = "https://work360.rising.sh";

// What every request pays before its handler runs, and what a sign-in pays.
describe("request path", () => {
  let bench: BenchHost;
  let token: string;

  async function login(): Promise<string> {
    const [executive] = bench.executives;
    if (!executive) {
      throw new Error("bench_host_has_no_executive");
    }
    const result = await bench.host.platform.auth.login.password(
      {
        identifier: executive.username,
        password: BENCH_PASSWORD,
        ipAddress: "198.51.100.10",
        userAgent: "codspeed-bench",
      },
      ORIGIN,
      operationAt(BENCH_NOW),
    );
    if (isErr(result) || result.value.kind !== "complete") {
      throw new Error(`expected a completed login: ${JSON.stringify(result)}`);
    }
    return result.value.result.token;
  }

  beforeAll(async () => {
    bench = await createBenchHost();
    token = await login();
  });

  test("resolve a session", async ({ bench: run }) => {
    const result = await run("resolve a session", async () => {
      const session = await bench.host.platform.auth.sessions.resolve(
        token,
        operationAt(BENCH_NOW),
      );
      if (!session) {
        throw new Error("expected a session");
      }
    }).run();
    expect(result.state).toBe("completed");
  });

  test("password login", async ({ bench: run }) => {
    const result = await run("password login", login).run();
    expect(result.state).toBe("completed");
  });

  // A cold Durable Object: open the migrated store and build the workspace
  // application over it. The fresh host's platform open is setup, not timed.
  test("wake a workspace", async ({ bench: run }) => {
    let cold: Host;
    const result = await run(
      "wake a workspace",
      {
        beforeEach: async () => {
          cold = await createHost(bench.openStore);
        },
      },
      async () => {
        await cold.workspace(bench.workspaceId);
      },
    ).run();
    expect(result.state).toBe("completed");
  });
});
