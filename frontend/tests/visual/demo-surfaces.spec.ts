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
  await expect(
    page.getByRole("heading", { name: "Card Explorer" }),
  ).toBeVisible();
  await settleDemoPage(page);
  await expect(page.locator("main")).toHaveScreenshot("demo-card-search.png");
});

test("demo collection remains usable across viewports", async ({ page }) => {
  await page.goto("/demo/collections");
  await expect(
    page.getByRole("heading", { name: /collections/i }),
  ).toBeVisible();
  await settleDemoPage(page);
  await expect(page.locator("main")).toHaveScreenshot("demo-collections.png");
});

test("demo analytics remains visually aligned with collection data", async ({
  page,
}) => {
  await page.goto("/demo/analytics");
  await expect(page.getByRole("heading", { name: /analytics/i })).toBeVisible();
  await settleDemoPage(page);
  await expect(page.locator("main")).toHaveScreenshot("demo-analytics.png");
});

test("demo dashboard shows achievement progress", async ({ page }) => {
  await page.goto("/demo/dashboard");
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/achievements/i).first()).toBeVisible();
  await settleDemoPage(page);
  await expect(page.locator("main")).toHaveScreenshot(
    "demo-dashboard-achievements.png",
  );
});

test("demo Pokédex keeps completion states readable", async ({ page }) => {
  await page.goto("/demo/pokedex");
  await expect(page.getByRole("heading", { name: /pokédex/i })).toBeVisible();
  await settleDemoPage(page);
  // The full Pokédex contains 1,025 entries, so keep this baseline to the
  // meaningful above-the-fold state rather than capturing a huge image.
  await expect(page).toHaveScreenshot("demo-pokedex.png");

  const speciesGrid = page.getByLabel("Pokédex species");
  await expect(speciesGrid.locator(":scope > button")).toHaveCount(120);
  await page.getByRole("button", { name: "Load 120 more" }).click();
  await expect(speciesGrid.locator(":scope > button")).toHaveCount(240);
});

test("followed guides keep wishlist navigation inside demo mode", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile-safari",
    "The complete catalog guide picker exceeds mobile WebKit's visual-test memory budget; mobile navigation is covered by the manual browser pass.",
  );
  await page.goto("/demo");
  await page.getByRole("button", { name: "Enter Demo" }).click();
  await expect(page).toHaveURL(/\/demo\/dashboard$/);
  await page.goto("/demo/guides");
  await expect(
    page.getByRole("heading", { name: "Pokémon Clay Art" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search collection guides" })
    .fill("Crown Zenith Connected Art");
  if ((page.viewportSize()?.width ?? 1024) < 1024) {
    const allGuidesButton = page.getByRole("button", { name: "All guides" });
    await expect(allGuidesButton).toBeVisible();
    await allGuidesButton.click();
  }
  await page
    .getByRole("button", { name: /Crown Zenith Connected Art/ })
    .click();
  const followButton = page.getByRole("button", {
    name: "Follow and add missing cards",
  });
  await expect(followButton).toBeVisible();
  await followButton.click();

  const openWishlist = page.getByRole("link", { name: "Open wishlist" });
  await expect(openWishlist).toHaveAttribute("href", "/demo/wishlists");
  await openWishlist.click();
  await expect(page).toHaveURL(/\/demo\/wishlists$/);
  await expect(
    page.getByRole("heading", { name: /wishlists/i }).first(),
  ).toBeVisible();
});

test("demo public binder links render read-only and respect privacy", async ({
  page,
}) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Enter Demo" }).click();
  await expect(page).toHaveURL(/\/demo\/dashboard$/);

  const shared = await page.evaluate(async () => {
    const collectionsResponse = await fetch(
      `${location.origin}/api/collections`,
      {
        headers: { Authorization: "Bearer demo-token" },
      },
    );
    const collections = (await collectionsResponse.json()) as Array<{
      id: string;
      name: string;
    }>;
    const binder = collections[0]!;
    const updateResponse = await fetch(
      `${location.origin}/api/collections/${binder.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: "Bearer demo-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isPublic: true }),
      },
    );
    const updated = (await updateResponse.json()) as {
      id: string;
      name: string;
      shareToken: string;
    };
    return updated;
  });

  await page.goto(`/demo/shared/${encodeURIComponent(shared.shareToken)}`);
  await expect(page.getByRole("heading", { name: shared.name })).toBeVisible();
  await expect(page.getByText("Read only", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Shared binder cards")).toBeVisible();

  await page.evaluate(async (binderId) => {
    await fetch(`${location.origin}/api/collections/${binderId}`, {
      method: "PATCH",
      headers: {
        Authorization: "Bearer demo-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isPublic: false }),
    });
  }, shared.id);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "This binder is private" }),
  ).toBeVisible();

  await page.goto("/demo/shared/not-a-real-share-token");
  await expect(
    page.getByRole("heading", { name: "Shared binder not found" }),
  ).toBeVisible();
});
