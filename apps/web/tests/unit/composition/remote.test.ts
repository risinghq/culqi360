import { describe, expect, it } from "vitest";

import { UserId } from "~/domain/ids";
import type {
  PlatformSurface,
  WorkspacePorts,
} from "~/server/composition/platform-application";
import { dispatch, remote, type Invoke } from "~/server/composition/remote";

// A surface shaped like a store application: nested ports, a method that
// reads its parent through `this`, and results carrying a Date.
function createSurface() {
  const counter = {
    count: 0,
    async bump(by: number) {
      this.count += by;
      return { count: this.count, at: new Date("2026-11-19T00:00:00.000Z") };
    },
  };
  return {
    auth: {
      login: {
        async password(input: { identifier: string }) {
          return { ok: true as const, value: input.identifier.toUpperCase() };
        },
      },
    },
    counter,
    async fail(): Promise<never> {
      throw new Error("refused");
    },
  };
}

type Surface = Omit<ReturnType<typeof createSurface>, "counter"> & {
  counter: { bump(by: number): Promise<{ count: number; at: Date }> };
};

// Each call crosses a structured clone both ways, as a Durable Object call
// does, and is counted.
function connect(surface: object) {
  const calls: string[][] = [];
  const invoke: Invoke = async (path, args) => {
    calls.push(path);
    return structuredClone(
      await dispatch(surface, structuredClone(path), structuredClone(args)),
    );
  };
  return { stub: remote<Surface>(invoke), calls };
}

describe("remote", () => {
  it("makes one call per operation, however deep the method", async () => {
    const { stub, calls } = connect(createSurface());

    expect(await stub.auth.login.password({ identifier: "ana" })).toEqual({
      ok: true,
      value: "ANA",
    });
    expect(calls).toEqual([["auth", "login", "password"]]);
  });

  it("calls the method on its own port and returns cloned values", async () => {
    const { stub } = connect(createSurface());

    await stub.counter.bump(2);
    const second = await stub.counter.bump(3);

    expect(second.count).toBe(5);
    expect(second.at).toBeInstanceOf(Date);
  });

  it("carries a thrown error back to the caller", async () => {
    const { stub } = connect(createSurface());

    await expect(stub.fail()).rejects.toThrow("refused");
  });

  it("is not a thenable, so awaiting a port yields the port", async () => {
    const { stub } = connect(createSurface());

    const port = await Promise.resolve(stub.auth);

    expect(typeof port.login.password).toBe("function");
  });

  // The type argument is the check: a sync member on either surface fails to
  // compile here.
  it("reaches the platform and workspace surfaces", async () => {
    const calls: string[][] = [];
    const invoke: Invoke = async (path) => {
      calls.push(path);
      return true;
    };
    const platform = remote<PlatformSurface>(invoke);
    const workspace = remote<WorkspacePorts>(invoke);

    await platform.webhooks.verifyWhatsAppSubscription({
      mode: "subscribe",
      token: null,
    });
    await workspace.auth.findMember(UserId.mint());

    expect(calls).toEqual([
      ["webhooks", "verifyWhatsAppSubscription"],
      ["auth", "findMember"],
    ]);
  });

  it("refuses a path that leaves the surface's own members", async () => {
    const surface = createSurface();

    await expect(dispatch(surface, ["toString"], [])).rejects.toThrow(
      "no member toString",
    );
    await expect(
      dispatch(surface, ["__proto__", "constructor"], []),
    ).rejects.toThrow("no member");
    await expect(dispatch(surface, ["counter", "count"], [])).rejects.toThrow(
      "no method counter.count",
    );
  });
});
