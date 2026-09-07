import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("future game capabilities install atomically and persist in a real browser", async () => {
  const bundle = await build({
    stdin: {
      contents: `export * from './frontend/src/lib/game-packages/game-package-client'; export { packageTrackedPrices } from './frontend/src/lib/pricing/package-prices';`,
      resolveDir: root,
      loader: "ts",
    },
    tsconfig: resolve(root, "frontend/tsconfig.json"),
    bundle: true,
    write: false,
    format: "iife",
    globalName: "packages",
    platform: "browser",
  });
  let corrupt = false;
  const server = createServer(async (request, response) => {
    try {
      const name = new URL(request.url, "http://localhost").pathname.slice(1);
      if (name === "client.js") {
        response.setHeader("content-type", "application/javascript");
        response.end(bundle.outputFiles[0].text);
        return;
      }
      if (!name) {
        response.setHeader("content-type", "text/html");
        response.end('<script src="/client.js"></script>');
        return;
      }
      if (
        ![
          "game-package.json",
          "cards.json",
          "packs.json",
          "prices.json",
        ].includes(name)
      ) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(
        corrupt && name === "prices.json"
          ? "{}"
          : await readFile(
              resolve(root, "docs/scanner-system/examples/star-garden", name),
            ),
      );
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    const result = await page.evaluate(async (url) => {
      const p = await packages.installGamePackage(`${url}/game-package.json`);
      await packages.installPackageCapability(p.id, "packs");
      await packages.installPackageCapability(p.id, "pricing");
      const cards = await packages.gamePackageCards(p.id);
      return {
        id: p.id,
        cards: cards.length,
        metadata: cards[0].attributes.tcger,
        prints: (
          await packages.installedCardPrints("star-garden", "scout-1", p.id)
        ).length,
        kinds: (await packages.installedPackageCapabilities())
          .map((c) => c.kind)
          .sort(),
      };
    }, url);
    assert.equal(result.id, "tcger-fixtures--star-garden");
    assert.equal(result.cards, 3);
    assert.equal(result.prints, 2);
    assert.equal(result.metadata.printings.finishes[0].foil, false);
    assert.deepEqual(result.kinds, ["packs", "pricing"]);
    const quote = await page.evaluate(async () => {
      const original = Date.now;
      Date.now = () => Date.parse("2026-09-05T00:00:00Z");
      try {
        return await packages.packageTrackedPrices([
          {
            tcg: "star-garden",
            externalId: "scout-1",
            finishCode: "matte",
            condition: "NM",
            language: "English",
          },
        ]);
      } finally {
        Date.now = original;
      }
    });
    assert.equal(quote.remaining.length, 0);
    assert.equal(quote.response.prices[0].price, 2);
    assert.equal(quote.response.prices[0].provenance.provider, result.id);
    await page.reload();
    assert.equal(
      await page.evaluate(
        async () => (await packages.installedPackageCapabilities()).length,
      ),
      2,
    );
    corrupt = true;
    const rejected = await page.evaluate(async (id) => {
      try {
        await packages.installPackageCapability(id, "pricing");
        return false;
      } catch {
        return true;
      }
    }, result.id);
    assert.equal(rejected, true);
    assert.equal(
      await page.evaluate(
        async () =>
          (await packages.installedPackageCapabilities()).find(
            (c) => c.kind === "pricing",
          ).pricing.quotes.length,
      ),
      3,
    );
    await page.evaluate(
      async (id) => packages.removeGamePackage(id),
      result.id,
    );
    assert.equal(
      await page.evaluate(
        async () => (await packages.installedPackageCapabilities()).length,
      ),
      0,
    );
    assert.equal(
      await page.evaluate(
        async (id) => (await packages.gamePackageCards(id)).length,
        result.id,
      ),
      0,
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
