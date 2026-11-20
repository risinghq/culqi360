// What `stores:push` and `stores:pull` share: the store names, their
// migrations, and the deployed end behind the Worker's load-token routes.
import { PLATFORM_MIGRATIONS } from "./schema/platform";
import { REGISTRY_MIGRATIONS } from "./schema/registry";
import { WORKSPACE_MIGRATIONS } from "./schema/workspace";
import { type StoreEnd, transportEnd } from "./store-pages";

export function migrationsOf(name: string) {
  if (name === "platform") {
    return PLATFORM_MIGRATIONS;
  }
  return name === "registry" ? REGISTRY_MIGRATIONS : WORKSPACE_MIGRATIONS;
}

// A deployed store, one POST per operation.
export function remoteEnd(base: string, token: string, name: string): StoreEnd {
  return transportEnd(async (operation, body) => {
    const url = new URL(`/api/admin/stores/${name}/${operation}`, base);
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${operation} ${name}: ${response.status} ${text}`);
    }
    return text;
  });
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
