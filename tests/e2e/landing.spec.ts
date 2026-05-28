import { test, expect } from "@playwright/test";
import { loginAsTestUser, hasE2ECredentials } from "./helpers/auth";

test.beforeEach(async ({ page }) => {
  test.skip(!hasE2ECredentials(), "E2E_USER_* ausentes — configure creds para rodar");
  await loginAsTestUser(page);
});

test("landing renders the Abissal hero with brand identity", async ({ page }) => {
  await page.goto("/");
  // Login aplicado no beforeEach → não deve cair em /login.
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("banca");
  await expect(page.getByText("habitada.")).toBeVisible();
});
