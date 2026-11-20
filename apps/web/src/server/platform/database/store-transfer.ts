// What `stores:push` and `stores:pull` share: the store names, their
// migrations, and the Worker's load-token routes.
import { PLATFORM_MIGRATIONS } from "./schema/platform";
import { REGISTRY_MIGRATIONS } from "./schema/registry";
import { WORKSPACE_MIGRATIONS } from "./schema/workspace";

export function migrationsOf(name: string) {
  if (name === "platform") {
    return PLATFORM_MIGRATIONS;
  }
  return name === "registry" ? REGISTRY_MIGRATIONS : WORKSPACE_MIGRATIONS;
}

export function storeUrl(base: string, name: string): string {
  return new URL(`/api/admin/stores/${name}`, base).toString();
}

export async function send(
  url: string,
  token: string,
  init: RequestInit,
): Promise<string> {
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method} ${url}: ${response.status} ${body}`);
  }
  return body;
}

export function transferArgs(command: string): { base: string; token: string } {
  const [base] = process.argv.slice(2);
  const token = process.env.LOAD_TOKEN;
  if (!base || !token) {
    throw new Error(`usage: LOAD_TOKEN=... bun run ${command} <worker-url>`);
  }
  return { base, token };
}

export function runTransfer(main: () => Promise<void>): void {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
