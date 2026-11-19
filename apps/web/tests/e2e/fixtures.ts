import {
  test as base,
  expect,
  type Browser,
  type Page,
} from "@playwright/test";

import { SERVER_ENTRY, WorkerData } from "./data";
import { rosterByKey, type RosterKey } from "./roster";
import { startServer, type RunningServer } from "./server";

const BASE_PORT = 41_100;

interface WorkerFixtures {
  workerData: WorkerData;
  workerServer: RunningServer;
}

interface TestFixtures {
  signInAs: (key: RosterKey) => Promise<Page>;
  asExecutive: Page;
  asBackOffice: Page;
  asManager: Page;
  asAdmin: Page;
  asSuperuser: Page;
  resetState: void;
}

async function openRolePage(
  browser: Browser,
  baseURL: string,
  key: RosterKey,
): Promise<Page> {
  const user = rosterByKey(key);
  const context = await browser.newContext({ baseURL });

  // Playwright rejects cookies that specify both `url` and `path`.
  await context.addCookies([
    { name: "session", value: user.token, url: baseURL },
  ]);

  return context.newPage();
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerData: [
    // Playwright requires destructuring even when the fixture has no dependencies.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const data = WorkerData.open(`w${test.info().parallelIndex}`);

      try {
        await use(data);
      } finally {
        data.close();
      }
    },
    { scope: "worker" },
  ],

  workerServer: [
    async ({ workerData }, use) => {
      const port = BASE_PORT + test.info().parallelIndex;
      const server = await startServer({
        serverEntry: SERVER_ENTRY,
        port,
        dataDir: workerData.dir,
      });

      try {
        await use(server);
      } finally {
        await server.stop();
      }
    },
    { scope: "worker" },
  ],

  baseURL: async ({ workerServer }, use) => {
    await use(workerServer.baseURL);
  },

  resetState: [
    async ({ workerData }, use) => {
      workerData.reset();
      await use();
    },
    { auto: true },
  ],

  signInAs: async ({ browser, workerServer }, use) => {
    const pages: Page[] = [];

    await use(async (key) => {
      const page = await openRolePage(browser, workerServer.baseURL, key);
      pages.push(page);
      return page;
    });

    for (const page of pages) {
      await page.context().close();
    }
  },

  // Keep these fixtures inline so Playwright can infer their dependencies.
  asExecutive: async ({ browser, workerServer }, use) => {
    const page = await openRolePage(browser, workerServer.baseURL, "executive");

    await use(page);
    await page.context().close();
  },

  asBackOffice: async ({ browser, workerServer }, use) => {
    const page = await openRolePage(
      browser,
      workerServer.baseURL,
      "back_office",
    );

    await use(page);
    await page.context().close();
  },

  asManager: async ({ browser, workerServer }, use) => {
    const page = await openRolePage(
      browser,
      workerServer.baseURL,
      "sales_manager",
    );

    await use(page);
    await page.context().close();
  },

  asAdmin: async ({ browser, workerServer }, use) => {
    const page = await openRolePage(browser, workerServer.baseURL, "admin");

    await use(page);
    await page.context().close();
  },

  asSuperuser: async ({ browser, workerServer }, use) => {
    const page = await openRolePage(browser, workerServer.baseURL, "superuser");

    await use(page);
    await page.context().close();
  },
});

export { expect };
