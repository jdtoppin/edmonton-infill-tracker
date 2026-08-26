import path from "node:path";
import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";

const userStorageState = path.resolve("playwright/.auth/user.json");
const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function stubTokenFreeBasemap(page: Page) {
  await page.route(/https:\/\/(?:tile|vector)\.openstreetmap\.org\/.*/, (route) => {
    const vectorTile = route.request().url().includes("vector.openstreetmap.org");
    return route.fulfill({
      status: 200,
      contentType: vectorTile ? "application/vnd.mapbox-vector-tile" : "image/png",
      headers: { "cache-control": "public, max-age=3600" },
      body: vectorTile ? Buffer.alloc(0) : transparentPng,
    });
  });
}

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
  await expect(page.getByText("Potential infill starts", { exact: true })).toBeVisible();
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
  const activeAreaCount = Number(await overviewMap.getAttribute("data-active-area-count"));
  const neighbourhoodActivityList = page.locator("[data-neighbourhood-activity-list]");
  await expect(neighbourhoodActivityList).toHaveAttribute(
    "data-active-area-count",
    String(activeAreaCount),
  );
  await expect(neighbourhoodActivityList.locator(":scope > a")).toHaveCount(activeAreaCount);
  if (activeAreaCount === 0) {
    await expect(
      neighbourhoodActivityList.getByText(
        "Neighbourhood totals will appear after projects are grouped.",
        { exact: true },
      ),
    ).toBeVisible();
  }
  expect((await overviewMapRegion.boundingBox())?.height).toBeGreaterThanOrEqual(300);
  await expect(
    overviewMap.getByText("zoom in to reveal individual projects", { exact: false }),
  ).toBeVisible();
  await expect(overviewMap).not.toHaveAttribute("data-map-state", "loading");
  if ((await overviewMap.getAttribute("data-map-state")) === "ready") {
    const summaryVisuals = overviewMap.locator("[data-neighbourhood-marker-visual]");
    const summaryWrappers = overviewMap.locator("[data-neighbourhood-marker]");
    const summaryCount = await summaryVisuals.count();
    if (summaryCount > 0) {
      const countBubbles = overviewMap.locator("[data-neighbourhood-marker] button");
      expect(await countBubbles.count()).toBe(summaryCount);
      await countBubbles.first().click();
      await expect(overviewMapRegion).toHaveAttribute("data-map-detail", "projects");
      await expect(summaryVisuals.first()).toHaveCSS("opacity", "0");
      await expect(summaryVisuals.first()).toHaveAttribute("aria-hidden", "true");
      await expect(summaryWrappers.first()).toHaveCSS("pointer-events", "none");
      await expect(countBubbles.first()).toHaveAttribute("tabindex", "-1");
      const projectMarkers = overviewMap.locator("[data-overview-project-marker]");
      await expect(projectMarkers.first()).toBeVisible();
      await projectMarkers.first().click();
      await expect(overviewMap.getByRole("link", { name: "View project timeline" })).toBeVisible();
    }
  }
  const exploreLink = page.getByRole("main").getByRole("link", { name: "Explore projects" });
  await expect(exploreLink).toBeVisible();
  expect(await exploreLink.evaluate((element) => getComputedStyle(element).color)).toBe(
    "rgb(255, 255, 255)",
  );
  for (const label of [
    "7 days",
    "30 days",
    "90 days",
    "180 days",
    "365 days",
    "Two years",
    "All time",
  ]) {
    await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.getByRole("link", { name: "30 days", exact: true }).click();
  await expect(page).toHaveURL(/\?period=30$/);
  await expect(page.getByRole("link", { name: "30 days", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.getByRole("region", { name: "Past 30 days summary" })).toBeVisible();
  await expect(exploreLink).toHaveAttribute("href", /from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
  const highConfidenceHref = await page
    .getByRole("link", { name: "View all", exact: true })
    .getAttribute("href");
  const highConfidenceParams = new URL(highConfidenceHref!, "http://infill.test").searchParams;
  expect(highConfidenceParams.get("minConfidence")).toBe("80");
  expect(highConfidenceParams.get("view")).toBe("split");
  expect(highConfidenceParams.get("scope")).toBe("core");
  expect(highConfidenceParams.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(highConfidenceParams.get("to")).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  await page.getByRole("link", { name: "All time", exact: true }).click();
  await expect(page).toHaveURL(/\?period=all$/);
  await expect(page.getByRole("link", { name: "All time", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.getByRole("region", { name: "All time summary" })).toBeVisible();
  await expect(exploreLink).toHaveAttribute("href", /^\/projects\?to=\d{4}-\d{2}-\d{2}$/);
  await expect(exploreLink).not.toHaveAttribute("href", /from=/);
  const allTimeHighConfidenceHref = await page
    .getByRole("link", { name: "View all", exact: true })
    .getAttribute("href");
  const allTimeHighConfidenceParams = new URL(allTimeHighConfidenceHref!, "http://infill.test")
    .searchParams;
  expect(allTimeHighConfidenceParams.get("minConfidence")).toBe("80");
  expect(allTimeHighConfidenceParams.get("view")).toBe("split");
  expect(allTimeHighConfidenceParams.get("scope")).toBe("core");
  expect(allTimeHighConfidenceParams.get("from")).toBeNull();
  expect(allTimeHighConfidenceParams.get("to")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const neighbourhoodLink = page.locator('a[href^="/projects?neighbourhood="]').first();
  const neighbourhoodHref = await neighbourhoodLink.getAttribute("href");
  const neighbourhoodParams = new URL(neighbourhoodHref!, "http://infill.test").searchParams;
  expect(neighbourhoodParams.get("neighbourhood")).toBeTruthy();
  expect(neighbourhoodParams.get("view")).toBe("split");
  expect(neighbourhoodParams.get("scope")).toBe("core");
  expect(neighbourhoodParams.get("from")).toBeNull();
  expect(neighbourhoodParams.get("to")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("drills dashboard neighbourhoods and categories into the matching split-map results", async ({
  page,
}) => {
  await page.goto("/?period=all");

  const neighbourhoodLink = page.locator('a[href^="/projects?neighbourhood="]').first();
  const neighbourhoodHref = await neighbourhoodLink.getAttribute("href");
  const neighbourhoodParams = new URL(neighbourhoodHref!, "http://infill.test").searchParams;
  await neighbourhoodLink.click();

  await expect(page.getByRole("link", { name: "Split" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-project-map]")).toBeVisible();
  await expect(page.locator('select[name="neighbourhood"]')).toHaveValue(
    neighbourhoodParams.get("neighbourhood")!,
  );
  expect(neighbourhoodParams.get("from")).toBeNull();
  await expect(page.locator('input[name="from"]')).toHaveValue("");
  await expect(page.locator('input[name="to"]')).toHaveValue(neighbourhoodParams.get("to")!);
  await expect(page.getByText("Core infill area:", { exact: false })).toBeVisible();

  await page.goto("/?period=all");
  const categoryLink = page.locator('a[href^="/projects?category="]').first();
  const categoryHref = await categoryLink.getAttribute("href");
  const categoryParams = new URL(categoryHref!, "http://infill.test").searchParams;
  await categoryLink.click();

  await expect(page.getByRole("link", { name: "Split" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-project-map]")).toBeVisible();
  await expect(page.locator('select[name="category"]')).toHaveValue(
    categoryParams.get("category")!,
  );
  expect(categoryParams.get("from")).toBeNull();
  await expect(page.locator('input[name="from"]')).toHaveValue("");
  await expect(page.locator('input[name="to"]')).toHaveValue(categoryParams.get("to")!);
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

test("renders the token-free light geographic basemap with visible attribution", async ({
  page,
}) => {
  await stubTokenFreeBasemap(page);

  await page.goto("/?period=all");
  const overviewMap = page.locator("[data-overview-map]");
  await expect(overviewMap).toHaveAttribute("data-map-state", "ready", { timeout: 15_000 });
  await expect(
    overviewMap.getByRole("link", { name: /OpenStreetMap contributors/i }),
  ).toBeVisible();
});

test("keeps neighbourhood count markers stable while hovered", async ({ page }) => {
  await stubTokenFreeBasemap(page);
  await page.goto("/?period=all");

  const overviewMap = page.locator("[data-overview-map]");
  await expect(overviewMap).toHaveAttribute("data-map-state", "ready", { timeout: 15_000 });
  const markers = overviewMap.locator("[data-neighbourhood-marker]");
  await expect(markers.first()).toBeVisible();
  const marker = markers.nth((await markers.count()) > 1 ? 1 : 0);
  const button = marker.getByRole("button");
  const expectedName = (await button.getAttribute("aria-label"))?.split(":", 1)[0];
  expect(expectedName).toBeTruthy();

  await button.hover();
  const samples = await marker.evaluate(async (element) => {
    const values: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
      transform: string;
    }> = [];
    for (let index = 0; index < 6; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const bounds = element.getBoundingClientRect();
      values.push({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        transform: getComputedStyle(element).transform,
      });
    }
    return values;
  });
  expect(samples.every((sample) => JSON.stringify(sample) === JSON.stringify(samples[0]))).toBe(
    true,
  );
  await expect(marker.locator("[data-neighbourhood-marker-label]")).toHaveCSS("opacity", "1");

  await button.click();
  await expect(overviewMap.locator("aside h3")).toHaveText(expectedName!);
  await expect(
    overviewMap.getByRole("region", {
      name: "Geographic map of project counts by Edmonton neighbourhood",
    }),
  ).toHaveAttribute("data-map-detail", "projects");
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
  await expect(page.getByRole("heading", { name: "Project evidence history" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /\d+% confidence/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Typical occupancy timing" })).toBeVisible();
  await expect(page.getByText("18-month planning baseline", { exact: true })).toBeVisible();

  await page.goto("/projects/seed-project-semi-detached");
  await expect(page.getByRole("heading", { name: "Project evidence history" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Typical occupancy timing" })).toHaveCount(0);
});

test("keeps list, map, and split views distinct and bounds the map list", async ({ page }) => {
  await stubTokenFreeBasemap(page);
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
  const projectMap = page.locator("[data-project-map]");
  await expect(projectMap).toHaveCount(1);
  await expect(projectMap).toHaveAttribute("data-map-state", "ready", { timeout: 15_000 });
  expect(Number(await projectMap.getAttribute("data-map-source-features"))).toBeGreaterThan(0);
  await expect
    .poll(async () => Number(await projectMap.getAttribute("data-map-rendered-project-features")), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  await expect(page.locator("[data-project-map-list]")).toHaveCount(1);
  await expect(page.locator("table")).toHaveCount(0);
  expect(await page.locator("[data-project-map-list] ol > li").count()).toBeLessThanOrEqual(26);

  const projectItems = page.locator("[data-project-map-list] ol > li").filter({
    has: page.getByRole("button", { name: "Show on map" }),
  });
  const targetItem = projectItems.nth((await projectItems.count()) > 1 ? 1 : 0);
  const targetHref = await targetItem.locator('a[href^="/projects/"]').first().getAttribute("href");
  const targetProjectId = targetHref?.split("/").at(-1);
  expect(targetProjectId).toBeTruthy();
  await targetItem.getByRole("button", { name: "Show on map" }).click();
  await expect(projectMap).toHaveAttribute("data-selected-project-id", targetProjectId!);
  await expect(projectMap.getByRole("link", { name: "View project timeline" })).toBeVisible();
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
