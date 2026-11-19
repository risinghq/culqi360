// One store's application seen from another Durable Object. A call such as
// `platform.auth.login.password(input)` becomes a single `invoke` of the path
// ["auth", "login", "password"] with its arguments, so each operation costs
// one billed Durable Object request however deep the method sits.

export type Invoke = (path: string[], args: unknown[]) => Promise<unknown>;

// A surface every leaf of which is a function returning a Promise. A plain
// value or a sync method cannot be read through a remote proxy, so the type
// rejects a surface that has one.
export type AsyncSurface<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => infer R
    ? R extends Promise<unknown>
      ? T[K]
      : never
    : T[K] extends object
      ? AsyncSurface<T[K]>
      : never;
};

// Keys that never name a surface member. `then` keeps an awaited proxy from
// looking like a thenable.
const NOT_MEMBERS = new Set(["then", "__proto__", "constructor", "prototype"]);

function proxyAt(invoke: Invoke, path: string[]): unknown {
  return new Proxy(() => undefined, {
    get(_, key) {
      if (typeof key === "symbol" || NOT_MEMBERS.has(key)) {
        return undefined;
      }
      return proxyAt(invoke, [...path, key]);
    },
    apply(_, __, args: unknown[]) {
      return invoke(path, args);
    },
  });
}

export function remote<T extends AsyncSurface<T>>(invoke: Invoke): T {
  // The proxy answers every path of T; no value can prove that to the checker.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return proxyAt(invoke, []) as T;
}

// The receiving side: walk the local surface along the path and call the
// method there with its parent as `this`. Only own members are reachable.
export async function dispatch(
  surface: object,
  path: string[],
  args: unknown[],
): Promise<unknown> {
  let parent: unknown;
  let member: unknown = surface;
  for (const key of path) {
    if (
      NOT_MEMBERS.has(key) ||
      typeof member !== "object" ||
      member === null ||
      !Object.hasOwn(member, key)
    ) {
      throw new Error(`no member ${path.join(".")}`);
    }
    parent = member;
    member = Reflect.get(member, key);
  }
  if (typeof member !== "function") {
    throw new Error(`no method ${path.join(".")}`);
  }
  return member.apply(parent, args);
}
