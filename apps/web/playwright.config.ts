import { defineConfig, devices } from "@playwright/test";

// globalSetup builds the server. Each worker runs its own server and database.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  // One server/database per worker. Ports are BASE_PORT + parallelIndex.
  workers: process.env.CI ? 2 : 4,

  reporter: process.env.CI ? "github" : "list",
  use: {
    // A missing element fails the action and names its locator, rather than
    // spending the whole test timeout.
    actionTimeout: 10_000,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
