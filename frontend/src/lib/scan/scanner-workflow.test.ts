import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ScanConsensus,
  gridQuads,
  validQuad,
  scanCurrencyTotals,
} from "./scanner-workflow";
import type { CardScanMatch } from "../api/scan";
const card = { externalId: "001", tcg: "pokemon" } as CardScanMatch;
test("automatic capture requires two stable observations and a rearm for another physical copy", () => {
  const consensus = new ScanConsensus();
  assert.equal(consensus.observe(card), false);
  assert.equal(consensus.observe(card), true);
  assert.equal(consensus.observe(card), false);
  consensus.observe(null);
  assert.equal(consensus.observe(card), false);
  assert.equal(consensus.observe(card), true);
  assert.equal(consensus.observe({ ...card, tcg: "magic" }), false);
});
test("page grids have valid ordered corners and reject a crossed crop", () => {
  const grid = gridQuads(900, 1200);
  assert.equal(grid.length, 9);
  assert.ok(grid.every(validQuad));
  const quad = grid[0]!;
  assert.equal(validQuad([quad[0], quad[2], quad[1], quad[3]]), false);
});
test("session price totals never sum different currencies", () => {
  assert.deepEqual(
    scanCurrencyTotals([
      { price: 10, currency: "USD" },
      { price: 15, currency: "EUR" },
      { price: 2, currency: "USD" },
    ]),
    { USD: 12, EUR: 15 },
  );
});
