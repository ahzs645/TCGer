import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
async function enterDemo(page: Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Enter Demo" }).click();
  await expect(page).toHaveURL(/\/demo\/dashboard$/);
}
async function settings(page: Page) {
  await page.getByRole("button", { name: "Open user menu" }).click();
  await page.getByRole("menuitem", { name: "Account & preferences" }).click();
}
test("[data.portableBackup] repeated imports preserve each physical copy and unknown sections", async ({
  page,
}) => {
  await enterDemo(page);
  await settings(page);
  const fixture = path.resolve(
    "../mobile-parity/fixtures/portable-backup-v2.json",
  );
  for (let i = 0; i < 2; i++) {
    await page.getByLabel("Import portable backup").setInputFiles(fixture);
    await page.getByRole("button", { name: "Import reviewed backup" }).click();
    await expect(
      page.getByText(
        "Import saved. A recovery point is available. Reload to refresh all open views.",
      ),
    ).toBeVisible();
  }
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON backup" }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  const binder = exported.binders.find(
    (item: { id: string }) => item.id === "fixture-binder",
  );
  expect(binder.cards).toHaveLength(3);
  expect(
    new Set(binder.cards.map((item: { id: string }) => item.id)).size,
  ).toBe(3);
  expect(
    binder.cards.find((item: { id: string }) => item.id === "pokemon-copy-1")
      .acquisitionPrice,
  ).toBe(4.25);
  expect(exported.sections.futureFeature).toEqual(
    JSON.parse(await readFile(fixture, "utf8")).sections.futureFeature,
  );
  await page.reload();
  await settings(page);
  const next = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON backup" }).click();
  const saved = JSON.parse(
    await readFile((await (await next).path())!, "utf8"),
  );
  expect(
    saved.binders.find((item: { id: string }) => item.id === "fixture-binder")
      .cards,
  ).toHaveLength(3);
});
test("[scanner.binderCorners] grid crops can be corrected and survive reload", async ({
  page,
}) => {
  await enterDemo(page);
  await page.goto("/demo/scan");
  const photo = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 900;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ddd";
    context.fillRect(0, 0, 600, 900);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await page.getByLabel("Upload scanner photo").setInputFiles({
    name: "binder-page.png",
    mimeType: "image/png",
    buffer: Buffer.from(photo, "base64"),
  });
  await page.getByRole("button", { name: "Use grid", exact: true }).click();
  const scanner = page.getByRole("region", {
    name: "Camera and binder scanner",
  });
  await expect(scanner.locator("polygon")).toHaveCount(9);
  await scanner
    .locator("polygon")
    .first()
    .click({ position: { x: 80, y: 100 } });
  await page.getByLabel("Corner 1 x", { exact: true }).fill("25");
  await expect(page.getByLabel("Corner 1 x", { exact: true })).toHaveValue(
    "25",
  );
  await page.screenshot({
    path: "test-results/parity/binder-corner-review.png",
    fullPage: true,
  });
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("tcger-scanner-review");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise<number>((resolve, reject) => {
            const request = db
              .transaction("drafts")
              .objectStore("drafts")
              .getAll();
            request.onsuccess = () =>
              resolve(request.result[0]?.regions[0]?.quad[0]?.x);
            request.onerror = () => reject(request.error);
          });
        } finally {
          db.close();
        }
      }),
    )
    .toBe(25);
  await page.reload();
  await expect(scanner.locator("polygon")).toHaveCount(9);
  await scanner
    .locator("polygon")
    .first()
    .click({ position: { x: 80, y: 100 } });
  await expect(page.getByLabel("Corner 1 x", { exact: true })).toHaveValue(
    "25",
  );
});

test("[scanner.binderReview] save selected cards and reopen a saved page photo", async ({
  page,
}) => {
  await enterDemo(page);
  await page.goto("/demo/scan");
  const photo = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 900;
    canvas.getContext("2d")!.fillRect(0, 0, 600, 900);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await page
    .getByLabel("Upload scanner photo")
    .setInputFiles({
      name: "page.png",
      mimeType: "image/png",
      buffer: Buffer.from(photo, "base64"),
    });
  await page.getByRole("button", { name: "Use grid", exact: true }).click();
  await page.getByLabel("Find a replacement card").fill("Pikachu");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByLabel("Card match").locator("option").first(),
  ).toContainText("Pikachu");
  await page
    .getByRole("button", { name: "Confirm match", exact: true })
    .click();
  const binder = page.getByLabel("Scanner destination binder");
  await expect(binder.locator("option").nth(1)).toBeAttached();
  await binder.selectOption(
    (await binder.locator("option").nth(1).getAttribute("value")) as string,
  );
  await page
    .getByRole("button", { name: "Save page & photo", exact: true })
    .click();
  await expect(page.getByText(/Page 1 and photo saved/)).toBeVisible();
  await page
    .getByRole("button", {
      name: "Add 1 reviewed cards to session",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Add session to binder", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Pikachu.*saved/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add session to binder", exact: true }),
  ).toBeDisabled();
  await page.reload();
  const saved = page.getByLabel("Saved binder page");
  await expect(saved.locator("option").nth(1)).toContainText("Page 1");
  await saved.selectOption(
    (await saved.locator("option").nth(1).getAttribute("value")) as string,
  );
  await page
    .getByRole("button", { name: "Review saved page", exact: true })
    .click();
  await expect(page.getByText(/Reviewing saved page 1/)).toBeVisible();
  await expect(
    page.getByLabel("Card match").locator("option").first(),
  ).toContainText("Pikachu");
  await page
    .getByRole("button", { name: "Save page & photo", exact: true })
    .click();
  await expect(saved.locator("option")).toHaveCount(2);
  await expect(saved.locator("option").nth(1)).toContainText("revision 2");
});

test("[cards.filteredSearch] a rare printing beyond the preview batch remains filterable", async ({
  page,
}) => {
  await enterDemo(page);
  await page.goto("/demo/cards");
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/cards/search") && url.includes("Parity")) {
        if (!url.includes("/cards/search/all?"))
          throw new Error("Filtering must use exhaustive search");
        return new Response(
          JSON.stringify({
            cards: Array.from({ length: 301 }, (_, index) => ({
              id: `parity-${index}`,
              externalId: `parity-${index}`,
              name:
                index === 300
                  ? "Parity rare printing"
                  : `Parity common ${index}`,
              tcg: "pokemon",
              setCode: index === 300 ? "RARE" : "BASE",
              setName: index === 300 ? "Rare fixture set" : "Base fixture set",
              rarity: index === 300 ? "Rare" : "Common",
            })),
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return original(input, init);
    };
  });
  await page.getByLabel("Keyword", { exact: true }).fill("Parity");
  await page.getByRole("button", { name: "Search cards", exact: true }).click();
  await page.getByRole("combobox", { name: "Set", exact: true }).click();
  await page.getByRole("option", { name: /Rare fixture set/ }).click();
  await expect(
    page.getByText("Parity rare printing", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Parity common 0", { exact: true })).toHaveCount(
    0,
  );
});
