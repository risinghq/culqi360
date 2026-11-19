import codspeedPlugin from "@codspeed/vitest-plugin";
import solid from "@solidjs/vite-plugin";
import {
  defineConfig,
  type TestProjectInlineConfiguration,
} from "vitest/config";

import { testAliases } from "./paths.ts";

// Each test file opens its own in-memory stores, so files run in parallel.
const databaseProject = {
  environment: "node" as const,
  testTimeout: 30_000,
  hookTimeout: 30_000,
};

const projects: TestProjectInlineConfiguration[] = [
  {
    extends: true,
    test: {
      name: "unit",
      include: ["tests/unit/**/*.test.ts"],
      environment: "node",
      fileParallelism: true,
    },
  },
  {
    // Browser builds of Solid, so effects run and cleanups fire. The unit
    // project resolves the server build, where effects never run. Component
    // tests opt into a DOM with `@vitest-environment happy-dom`.
    extends: true,
    plugins: [solid()],
    resolve: { conditions: ["browser"] },
    ssr: { resolve: { conditions: ["browser"] } },
    test: {
      name: "client",
      include: ["tests/client/**/*.test.{ts,tsx}"],
      environment: "node",
      server: { deps: { inline: [/solid-js/, /@solidjs/] } },
    },
  },
  {
    extends: true,
    test: {
      name: "contract",
      ...databaseProject,
      include: ["tests/contract/**/*.test.ts"],
    },
  },
  {
    extends: true,
    test: {
      name: "integration",
      ...databaseProject,
      include: ["tests/integration/**/*.test.ts"],
    },
  },
  {
    extends: true,
    test: {
      name: "journey",
      ...databaseProject,
      include: ["tests/journey/**/*.test.ts"],
      fileParallelism: false,
    },
  },
];

export default defineConfig({
  plugins: [codspeedPlugin()],
  test: {
    globalSetup: ["../../packages/email-composer/tests/global-setup.ts"],
    reporters: process.env.GITHUB_ACTIONS
      ? ["dot", "github-actions"]
      : ["default", "github-actions"],
    server: {
      deps: {
        inline: ["@solidjs/start"],
      },
    },
    projects,
  },
  resolve: { alias: { ...testAliases } },
});
