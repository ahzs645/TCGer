import { expect, test } from "@playwright/test";

test("[cards.search] narrow phone result cards keep their actions readable and inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/demo");
  await page.getByRole("button", { name: "Enter Demo" }).click();
  await expect(page).toHaveURL(/\/demo\/dashboard$/);
  await page.goto("/demo/cards");
  await page.getByLabel("Keyword", { exact: true }).fill("Pikachu");
  await page.getByRole("button", { name: "Search cards", exact: true }).click();
  const actions = page.getByRole("button", { name: "Compare market quotes", exact: true });
  await expect(actions).toHaveCount(2);
  for (const action of await actions.all()) {
    await action.scrollIntoViewIfNeeded();
    const bounds = await action.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(16);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(304);
    expect(bounds!.width).toBeGreaterThanOrEqual(200);
    expect(await action.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
});

test("[settings.browse] phone settings keep account details and game switches inside the dialog", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/demo");
  await page.getByRole("button", { name: "Enter Demo" }).click();
  await expect(page).toHaveURL(/\/demo\/dashboard$/);
  await page.getByRole("button", { name: "Open user menu" }).click();
  await page.getByRole("menuitem", { name: "Account & preferences" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  const toggle = dialog.getByRole("switch", { name: "Toggle Pokémon", exact: true });
  await toggle.scrollIntoViewIfNeeded();
  const bounds = await toggle.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(16);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(304);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
});

for (const partial of [false, true]) {
  test(`[cards.search] provider ${partial ? "partial results stay visible with a warning" : "failure never appears as no matches"}`, async ({ page }) => {
    await page.goto("/demo");
    await page.getByRole("button", { name: "Enter Demo" }).click();
    await expect(page).toHaveURL(/\/demo\/dashboard$/);
    await page.goto("/demo/cards");
    await page.evaluate((partial) => {
      const original = window.fetch;
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/cards/search/all?") && url.includes("Reliability")) {
          return Response.json(partial
            ? { cards: [{ id: "reliability-pikachu", name: "Reliability Pikachu", tcg: "pokemon" }], total: 1, failedProviders: ["magic"] }
            : { error: "CARD_SEARCH_UNAVAILABLE", message: "Card search is incomplete. Try again or select a single game." }, { status: partial ? 200 : 503 });
        }
        return original(input, init);
      };
    }, partial);
    await page.getByLabel("Keyword", { exact: true }).fill("Reliability");
    await page.getByRole("button", { name: "Search cards", exact: true }).click();
    if (partial) {
      await expect(page.getByText("Reliability Pikachu", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("alert").filter({ hasText: "Showing partial results" })).toBeVisible();
    } else {
      await expect(page.getByRole("alert").filter({ hasText: "Card search is incomplete" })).toBeVisible();
      await expect(page.getByText(/No exact matches/)).toHaveCount(0);
    }
  });
}
