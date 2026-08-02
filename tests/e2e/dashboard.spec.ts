import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const userStorageState = path.resolve("playwright/.auth/user.json");

async function signIn(page: Page, role: "admin" | "user" = "admin") {
  await page.goto("/login");
  await page
    .getByLabel("Email address")
    .fill(
      role === "admin"
        ? (process.env.INITIAL_ADMIN_EMAIL ?? "admin@example.test")
        : (process.env.SEED_USER_EMAIL ?? "user@example.test"),
    );
  await page
    .locator("#password")
    .fill(
      role === "admin"
        ? (process.env.SEED_ADMIN_PASSWORD ?? "ci-admin-password-not-for-production")
        : (process.env.SEED_USER_PASSWORD ?? "ci-user-password-not-for-production"),
    );
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

test("@responsive shows the live permit intelligence overview", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Follow infill from first permit to occupancy." }),
  ).toBeVisible();
  await expect(page.getByText("New projects detected", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "High-confidence projects" })).toBeVisible();
  await page.getByRole("button", { name: "30 days" }).click();
  await expect(page.getByRole("button", { name: "30 days" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("@responsive filters projects and opens a normalized permit timeline", async ({ page }) => {
  await page.goto("/projects?q=99901&view=list");
  await expect(
    page.getByRole("heading", { name: "Find infill signals across Edmonton." }),
  ).toBeVisible();
  await expect(page).toHaveURL(/q=99901/);
  const projectLink = page
    .locator('a[href^="/projects/"]:visible')
    .filter({ hasText: "99901" })
    .first();
  await expect(projectLink).toBeVisible();
  await projectLink.click();
  await expect(page.getByRole("heading", { name: "Permit timeline" })).toBeVisible();
  await expect(page.getByText(/confidence/i).first()).toBeVisible();
});

test("exports the authenticated filtered project set as CSV", async ({ page }) => {
  const response = await page.request.get("/api/projects/export?q=99901");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("text/csv");
  const csv = await response.text();
  expect(csv).toContain("Address,Neighbourhood,Category");
  expect(csv).toContain("99901 127 ST NW");
  expect(csv).not.toContain("rawSourcePayload");
});

test("protects administration, exposes update handoff, and fully revokes logout", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?returnTo=/);

  await signIn(page);
  await page.goto("/admin/updates");
  await expect(page.getByRole("heading", { name: "Application updates" })).toBeVisible();
  await expect(page.getByText("./scripts/infill update", { exact: true })).toBeVisible();

  const visibleSignOut = page.locator("button:visible").filter({ hasText: "Sign out" });
  if ((await visibleSignOut.count()) === 0) {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
  }
  await visibleSignOut.first().click();
  await expect(page).toHaveURL("/login");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await context.close();
});

test("does not show or allow administration for an ordinary user", async ({ browser }) => {
  const context = await browser.newContext({ storageState: userStorageState });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page).toHaveURL("/");
  await context.close();
});
