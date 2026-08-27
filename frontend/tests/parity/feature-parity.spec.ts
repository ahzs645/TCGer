import { expect, test, type Page } from "@playwright/test";
import {
  ParityFeatureIDs,
  type ParityFeatureID,
} from "../../src/generated/parity.generated";

function parityTitle(featureID: ParityFeatureID, title: string) {
  return `[${featureID}] ${title}`;
}

async function enterDemo(page: Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Enter Demo" }).click();
  await expect(page).toHaveURL(/\/demo\/dashboard$/);
}

test(
  parityTitle(ParityFeatureIDs.homeDashboard, "dashboard is usable"),
  async ({ page }) => {
    await enterDemo(page);
    await expect(
      page.getByRole("heading", { name: "Dashboard", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/achievements/i).first()).toBeVisible();
  },
);

test(
  parityTitle(ParityFeatureIDs.collectionsBrowse, "binders can be browsed"),
  async ({ page }) => {
    await enterDemo(page);
    await page.goto("/demo/collections");
    await expect(
      page.getByRole("heading", { name: "Collections", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /all binders/i }),
    ).toBeVisible();
  },
);

test(
  parityTitle(ParityFeatureIDs.collectionsCreate, "a binder can be created"),
  async ({ page }) => {
    await enterDemo(page);
    await page.goto("/demo/collections");
    await page.getByRole("button", { name: /all binders/i }).click();
    await page.getByRole("menuitem", { name: "Add binder" }).click();
    const dialog = page.getByRole("dialog", { name: "Create binder" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Binder name").fill("Parity Binder");
    await dialog.getByRole("button", { name: "Create binder" }).click();
    await expect(
      page.getByText("Parity Binder", { exact: true }),
    ).toBeVisible();
  },
);

test(
  parityTitle(ParityFeatureIDs.cardsSearch, "cards can be searched"),
  async ({ page }) => {
    await enterDemo(page);
    await page.goto("/demo/cards");
    await expect(
      page.getByRole("heading", { name: "Card Explorer" }),
    ).toBeVisible();
    await expect(page.getByRole("textbox").first()).toBeVisible();
  },
);

test(
  parityTitle(ParityFeatureIDs.wishlistsBrowse, "wishlists can be browsed"),
  async ({ page }) => {
    await enterDemo(page);
    await page.goto("/demo/wishlists");
    await expect(
      page.getByRole("heading", { name: "Wishlists", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New Wishlist" }),
    ).toBeVisible();
  },
);

test(
  parityTitle(ParityFeatureIDs.wishlistsCreate, "a wishlist can be created"),
  async ({ page }) => {
    await enterDemo(page);
    await page.goto("/demo/wishlists");
    await page.getByRole("button", { name: "New Wishlist" }).click();
    const dialog = page.getByRole("dialog", { name: "Create Wishlist" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Name", { exact: true }).fill("Parity Wishlist");
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(
      page
        .getByRole("heading", { name: "Parity Wishlist", exact: true })
        .first(),
    ).toBeVisible();
  },
);

test(
  parityTitle(ParityFeatureIDs.settingsBrowse, "settings can be opened"),
  async ({ page }) => {
    await enterDemo(page);
    await page.getByRole("button", { name: "Open user menu" }).click();
    await page.getByRole("menuitem", { name: "Account & preferences" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Price source" }),
    ).toBeVisible();
  },
);
