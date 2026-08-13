import { expect, test, type Page } from "@playwright/test";

async function settleDemoPage(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo({ top: 0, behavior: "instant" });
  });
}

test("demo card search keeps its shared card surface", async ({ page }) => {
  await page.goto("/demo/cards");
  await expect(page.getByRole("heading", { name: "Card Explorer" })).toBeVisible();
  await settleDemoPage(page);
  await expect(page.locator("main")).toHaveScreenshot("demo-card-search.png");
});

test("demo collection remains usable across viewports", async ({ page }) => {
  await page.goto("/demo/collections");
  await expect(page.getByRole("heading", { name: /collections/i })).toBeVisible();
  await settleDemoPage(page);
  await expect(page.locator("main")).toHaveScreenshot("demo-collections.png");
});

test("demo analytics remains visually aligned with collection data", async ({ page }) => {
  await page.goto("/demo/analytics");
  await expect(page.getByRole("heading", { name: /analytics/i })).toBeVisible();
  await settleDemoPage(page);
  await expect(page.locator("main")).toHaveScreenshot("demo-analytics.png");
});

test("demo dashboard shows achievement progress", async ({ page }) => {
  await page.goto("/demo/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByText(/achievements/i).first()).toBeVisible();
  await settleDemoPage(page);
  await expect(page.locator("main")).toHaveScreenshot("demo-dashboard-achievements.png");
});

test("demo Pokédex keeps completion states readable", async ({ page }) => {
  await page.goto("/demo/pokedex");
  await expect(page.getByRole("heading", { name: /pokédex/i })).toBeVisible();
  await settleDemoPage(page);
  // The full Pokédex contains 1,025 entries, so keep this baseline to the
  // meaningful above-the-fold state rather than capturing a huge image.
  await expect(page).toHaveScreenshot("demo-pokedex.png");
});
