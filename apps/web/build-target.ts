import { basename, resolve } from "node:path";

import type { Plugin } from "vite";

// The server modules that differ by target. A Workers build resolves each to
// its `.workers.ts` sibling, wherever and however it is imported.
const TARGET_MODULES = ["src/server/entrypoints/runtime.ts"].map((path) =>
  resolve(import.meta.dirname, path),
);
const TARGET_NAMES = new Set(
  TARGET_MODULES.map((path) => basename(path, ".ts")),
);

export type BuildTarget = "bun" | "workers";

export function resolveBuildTarget(env: NodeJS.ProcessEnv): BuildTarget {
  return env.BUILD_TARGET === "workers" ? "workers" : "bun";
}

export function buildTargetPlugin(target: BuildTarget): Plugin[] {
  if (target === "bun") {
    return [];
  }
  return [
    {
      name: "workers-target-modules",
      enforce: "pre",
      async resolveId(source, importer, options) {
        if (!TARGET_NAMES.has(basename(source, ".ts"))) {
          return null;
        }
        const resolved = await this.resolve(source, importer, {
          ...options,
          skipSelf: true,
        });
        return resolved && TARGET_MODULES.includes(resolved.id)
          ? resolved.id.replace(/\.ts$/, ".workers.ts")
          : null;
      },
    },
  ];
}
