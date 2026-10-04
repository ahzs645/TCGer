import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

async function enterDemo(page: Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Enter Demo" }).click();
  await expect(page).toHaveURL(/\/demo\/dashboard$/);
}

test("[navigation.appLinks] canonical native URLs preserve web destinations and identifiers", async ({ request }) => {
  for (const [source, destination] of [
    ["/search?q=Black%20Lotus", "/cards?q=Black%20Lotus"],
    ["/binder/fixture-binder", "/collections?binder=fixture-binder"],
    ["/wishlist/fixture-wishlist", "/wishlists?wishlist=fixture-wishlist"],
  ]) {
    const response = await request.get(source, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(new URL(response.headers().location, response.url()).pathname + new URL(response.headers().location, response.url()).search).toBe(destination);
  }
});

test("[navigation.appLinks] a search link executes its supplied query", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/demo/cards?q=Pikachu");
  await expect(page.getByLabel("Keyword", { exact: true })).toHaveValue("Pikachu");
  await expect(page.getByText("Pikachu", { exact: true }).first()).toBeVisible();
});

test("[navigation.appLinks] a wishlist link selects its record and rejects a missing target", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "Open user menu" }).click();
  await page.getByRole("menuitem", { name: "Account & preferences" }).click();
  await page.getByLabel("Import portable backup").setInputFiles(path.resolve("../mobile-parity/fixtures/portable-backup-v2.json"));
  await page.getByRole("button", { name: "Import reviewed backup" }).click();
  await expect(page.getByText("Import saved. A recovery point is available. Reload to refresh all open views.")).toBeVisible();
  await page.goto("/demo/wishlists?wishlist=fixture-wishlist");
  await expect(page.getByRole("heading", { name: "Every Pikachu", exact: true }).first()).toBeVisible();
  await page.goto("/demo/wishlists?wishlist=missing-target");
  await expect(page.getByText("This wishlist is unavailable for the current account.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Every Pikachu", exact: true })).toHaveCount(0);
});
