import { expect, test } from "./fixtures";
import { ROSTER_PASSWORD, rosterByKey } from "./roster";

const EXECUTIVE = rosterByKey("executive");

test.describe("sign-in", () => {
  test.beforeEach(({ workerData }) => {
    workerData.workspace.run(
      "update members set onboarding_completed_at = null where user_id = ?",
      EXECUTIVE.userId,
    );
  });

  // The sign-in response sets the session cookie and redirects. The page it
  // redirects to must load with the new session; its data read with the old,
  // anonymous one sends the user back to /login.
  test("a user who has not onboarded signs in and lands on onboarding", async ({
    browser,
    workerServer,
  }) => {
    const context = await browser.newContext({
      baseURL: workerServer.baseURL,
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/login");
    await page
      .getByRole("textbox", { name: "Usuario", exact: true })
      .fill(EXECUTIVE.username);
    await page
      .getByRole("textbox", { name: "Contraseña", exact: true })
      .fill(ROSTER_PASSWORD);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();

    await expect(page).toHaveURL(/\/onboarding$/);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/onboarding$/);
    expect(pageErrors).toEqual([]);

    await context.close();
  });
});
