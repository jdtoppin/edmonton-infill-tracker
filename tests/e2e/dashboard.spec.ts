import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/login");
  await page
    .getByLabel("Email address")
    .fill(process.env.INITIAL_ADMIN_EMAIL ?? "admin@example.test");
  await page
    .locator("#password")
    .fill(process.env.SEED_ADMIN_PASSWORD ?? "ci-admin-password-not-for-production");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

test("signs in and shows the permit intelligence overview", async ({ page }) => {
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: /from first approval to occupancy/i }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Occupancy granted" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "High-confidence projects" })).toBeVisible();
  await expect(page.getByText("10524 75 Avenue NW").first()).toBeVisible();
  await page.getByRole("button", { name: "30 days" }).click();
  await expect(page.getByText("31", { exact: true })).toBeVisible();
});

test("protects administration and allows an administrator", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?returnTo=/);

  await signIn(page);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Operations centre" })).toBeVisible();
});
