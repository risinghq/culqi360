# End-to-end testing

The Playwright suite runs a built work360 server over its own SQLite stores. It
uses seeded sessions and the `email:log` notification route. It does not start
or replace the engine, so it does not cover engine-backed search.

## Run the suite

Install the browser once. On Linux, `--with-deps` also installs its system
libraries and asks for `sudo` itself:

```sh
cd apps/web
bunx playwright install --with-deps chromium
```

Then run from `apps/web`:

```sh
bun run test:e2e
bun run test:e2e:headed
bun run test:e2e:ui
```

The commands load `.env.test`.

## How it runs

Playwright global setup runs [`prepare.ts`](../apps/web/tools/e2e/prepare.ts).
The script builds the application when the build is stale. It then writes a
template data directory, `apps/web/.e2e-data/template`: the installation without
demo data, plus the roster. Global teardown deletes `.e2e-data`.

Each Playwright worker copies the template to its own data directory and starts
its own built server over it, on port 41100 plus its Playwright parallel index.
An automatic fixture restores every store to the template before each test. It
skips a store the last test did not write. Workers do not share state. The suite
runs 4 workers, or 2 when `CI` is set.

Each worker server also gets its own `WEB_UPLOADS_ROOT`, a temporary directory
that is removed when the worker stops.

## Authentication and external services

`prepare.ts` seeds one user for every role in
[`roster.ts`](../apps/web/tests/e2e/roster.ts). Role fixtures create browser
contexts with the matching session cookie; they do not submit the login form.

The page fixtures are `asExecutive`, `asBackOffice`, `asManager`, `asAdmin`, and
`asSuperuser`. `signInAs(key)` accepts any roster key.

The built server runs with `NOTIFICATION_ROUTES=email:log`. That route writes
each composed email to the server log as `email.logged` and sends nothing. There
is no mailbox helper; a test that needs an invite link reads it from the page.

## Write a test

Import `test` and `expect` from
[`fixtures.ts`](../apps/web/tests/e2e/fixtures.ts). Use a role fixture unless
the test is about authentication.

```ts
test("shows the records workspace to an executive", async ({ asExecutive }) => {
  await asExecutive.goto("/records");
  await expect(asExecutive).not.toHaveURL(/\/login/);
});
```

Create state through work360 when you test user behavior. A test that needs a
platform row the UI cannot create writes it with `workerData.platform.run`.

## Files

| Path                                                                       | Purpose                                                   |
| -------------------------------------------------------------------------- | --------------------------------------------------------- |
| [`tools/e2e/prepare.ts`](../apps/web/tools/e2e/prepare.ts)                 | Builds work360 and writes the template data directory.    |
| [`tests/e2e/roster.ts`](../apps/web/tests/e2e/roster.ts)                   | Defines seeded users and sessions.                        |
| [`tests/e2e/global-setup.ts`](../apps/web/tests/e2e/global-setup.ts)       | Runs `prepare.ts` before the suite.                       |
| [`tests/e2e/global-teardown.ts`](../apps/web/tests/e2e/global-teardown.ts) | Deletes the template and worker data directories.         |
| [`tests/e2e/data.ts`](../apps/web/tests/e2e/data.ts)                       | Copies the template for a worker and restores its stores. |
| [`tests/e2e/server.ts`](../apps/web/tests/e2e/server.ts)                   | Starts one built server per worker.                       |
| [`tests/e2e/fixtures.ts`](../apps/web/tests/e2e/fixtures.ts)               | Owns the worker lifecycle and authentication.             |
| [`tests/e2e/*.spec.ts`](../apps/web/tests/e2e/)                            | Contains the browser tests.                               |
