import { expect, test } from "./fixtures";
import { rosterByKey } from "./roster";

const UNKNOWN_LEAD_ID = "0e2e0000-0000-7000-8000-00000000dead";

// Drives the production server over HTTP rather than a browser. The failure is
// server-side: the route preload rejects while the response is being rendered.
test.describe("unknown lead", () => {
  test("a record URL for a lead that does not exist is not a server fault", async ({
    playwright,
    workerServer,
  }) => {
    const client = await playwright.request.newContext({
      baseURL: workerServer.baseURL,
      extraHTTPHeaders: {
        cookie: `session=${rosterByKey("executive").token}`,
      },
    });

    const response = await client.get(`/records/${UNKNOWN_LEAD_ID}`);
    await response.body();
    await client.dispose();

    expect(response.status()).toBe(200);

    // Unhandled rejections are logged by runtime-lifecycle and reported to
    // Sentry from the same handler.
    expect(workerServer.output()).not.toContain("unhandled_rejection");
    expect(workerServer.output()).not.toContain("action_fault");
  });

  // A client navigation reads the lead through a server function, so the
  // typed `not_found` must survive the HTTP response to reach the boundary.
  test("following a link to a lead that does not exist shows the not-found page", async ({
    asExecutive,
  }) => {
    await asExecutive.goto("/records");
    await asExecutive.evaluate((href) => {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = "unknown lead";
      document.body.append(link);
    }, `/records/${UNKNOWN_LEAD_ID}`);
    const leadRead = asExecutive.waitForResponse((response) =>
      decodeURIComponent(response.url()).includes(UNKNOWN_LEAD_ID),
    );
    await asExecutive.getByRole("link", { name: "unknown lead" }).click();

    // A missing record is the caller's error, not a server fault.
    expect((await leadRead).status()).toBe(404);
    await expect(
      asExecutive.getByText("Me parece que te has perdido"),
    ).toBeVisible();
  });
});
