import path from "node:path";
import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";

const userStorageState = path.resolve("playwright/.auth/user.json");
const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

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
  await expect(page.getByText("New infill starts", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "High-confidence projects" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Project activity map" })).toBeVisible();
  const overviewMap = page.locator("[data-overview-map]");
  await expect(overviewMap).toBeVisible();
  await expect(overviewMap).toHaveAttribute(
    "data-map-state",
    /^(loading|ready|empty|unsupported|error)$/,
  );
  await expect(
    overviewMap.getByRole("region", {
      name: "Geographic map of project counts by Edmonton neighbourhood",
    }),
  ).toBeVisible();
  const overviewMapRegion = overviewMap.getByRole("region", {
    name: "Geographic map of project counts by Edmonton neighbourhood",
  });
  expect((await overviewMapRegion.boundingBox())?.height).toBeGreaterThanOrEqual(300);
  await expect(
    overviewMap.getByText("circles do not represent neighbourhood boundaries", { exact: false }),
  ).toBeVisible();
  const exploreLink = page.getByRole("main").getByRole("link", { name: "Explore projects" });
  await expect(exploreLink).toBeVisible();
  expect(await exploreLink.evaluate((element) => getComputedStyle(element).color)).toBe(
    "rgb(255, 255, 255)",
  );
  await page.getByRole("button", { name: "30 days" }).click();
  await expect(page.getByRole("button", { name: "30 days" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("keeps the overview Explore projects button stationary on hover", async ({ page }) => {
  await page.goto("/");
  const exploreLink = page.getByRole("main").getByRole("link", { name: "Explore projects" });
  await expect(exploreLink).toBeVisible();
  const exploreLinkBeforeHover = await exploreLink.boundingBox();
  await exploreLink.hover();
  await exploreLink.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  expect(await exploreLink.boundingBox()).toEqual(exploreLinkBeforeHover);
});

test("renders the token-free geographic basemap with visible attribution", async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "cache-control": "public, max-age=3600" },
      body: transparentPng,
    }),
  );

  await page.goto("/");
  const overviewMap = page.locator("[data-overview-map]");
  await expect(overviewMap).toHaveAttribute("data-map-state", "ready", { timeout: 15_000 });
  await expect(
    overviewMap.getByRole("link", { name: /OpenStreetMap contributors/i }),
  ).toBeVisible();
});

test("@responsive filters projects and opens a normalized permit timeline", async ({ page }) => {
  await page.goto("/projects?q=99901&view=list");
  await expect(
    page.getByRole("heading", { name: "Find infill signals across Edmonton." }),
  ).toBeVisible();
  await expect(page).toHaveURL(/q=99901/);
  const activeListView = page.getByRole("link", { name: "List" });
  await expect(activeListView).toHaveAttribute("aria-current", "page");
  expect(await activeListView.evaluate((element) => getComputedStyle(element).color)).toBe(
    "rgb(23, 100, 115)",
  );
  const infillStartLabel = page
    .locator("th:visible a, dt:visible")
    .filter({ hasText: /^Infill start$/ })
    .first();
  await expect(infillStartLabel).toBeVisible();
  const projectLink = page
    .locator('a[href^="/projects/"]:visible')
    .filter({ hasText: "99901" })
    .first();
  await expect(projectLink).toBeVisible();
  await projectLink.click();
  await expect(page.getByRole("heading", { name: "Permit timeline" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /\d+% confidence/ })).toBeVisible();
});

test("keeps list, map, and split views distinct and bounds the map list", async ({ page }) => {
  await page.goto("/projects?q=999&view=list");
  await expect(page.locator("[data-project-map]")).toHaveCount(0);
  await expect(page.locator("table")).toHaveCount(1);

  await page.goto("/projects?q=999&view=map");
  await expect(page.locator("[data-project-map]")).toHaveCount(1);
  expect(
    (await page.getByRole("region", { name: "Map of Edmonton infill projects" }).boundingBox())
      ?.height,
  ).toBeGreaterThanOrEqual(400);
  await expect(page.locator("[data-project-map-list]")).toHaveCount(0);
  await expect(page.locator("table")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Browse all in List view" })).toHaveAttribute(
    "href",
    /view=list/,
  );

  await page.goto("/projects?q=999&view=split");
  await expect(page.locator("[data-project-map]")).toHaveCount(1);
  await expect(page.locator("[data-project-map-list]")).toHaveCount(1);
  await expect(page.locator("table")).toHaveCount(0);
  expect(await page.locator("[data-project-map-list] ol > li").count()).toBeLessThanOrEqual(26);
});

test("exports the authenticated filtered project set as CSV", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/projects/export?q=99901");
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      csv: await response.text(),
    };
  });
  expect(result.status).toBe(200);
  expect(result.contentType).toContain("text/csv");
  expect(result.csv).toContain("Address,Neighbourhood,Category");
  expect(result.csv).toContain("99901 127 ST NW");
  expect(result.csv).not.toContain("rawSourcePayload");
});

test("protects administration, exposes update handoff, and fully revokes logout", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
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
