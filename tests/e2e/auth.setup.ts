import path from "node:path";
import { mkdir } from "node:fs/promises";
import { expect, test as setup, type Page } from "@playwright/test";

const authDirectory = path.resolve("playwright/.auth");

async function authenticate(page: Page, role: "admin" | "user") {
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

setup.beforeAll(async () => {
  await mkdir(authDirectory, { recursive: true });
});

setup("authenticate administrator", async ({ page }) => {
  await authenticate(page, "admin");
  await page.context().storageState({ path: path.join(authDirectory, "admin.json") });
});

setup("authenticate ordinary user", async ({ page }) => {
  await authenticate(page, "user");
  await page.context().storageState({ path: path.join(authDirectory, "user.json") });
});
