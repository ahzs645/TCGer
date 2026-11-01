import assert from "node:assert/strict";
import test from "node:test";
import type { Binder, TransactionResponse } from "@tcg/api-types";
import { inferredSaleCost, UNKNOWN_CURRENCY } from "./acquisition-currency";
import { formatMoney } from "@/lib/format-money";

import {
  buildPurchasePerformanceLots,
  convertPurchasePerformanceLots,
  purchaseCostCoverage,
  purchasePriceItems,
} from "./purchase-performance";

const collections = [
  {
    id: "binder-1",
    name: "Promos",
    cards: [
      {
        id: "copy-1",
        cardId: "card-darkrai",
        externalId: "dp24",
        name: "Darkrai",
        tcg: "pokemon",
        setName: "DP Black Star Promos",
        quantity: 1,
        condition: "Near Mint",
        language: "English",
        copies: [
          {
            id: "copy-1",
            condition: "Near Mint",
            language: "English",
            finishCode: "non-holo",
            price: 31,
            tags: [],
          },
        ],
      },
    ],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
] as Binder[];

const transaction: TransactionResponse = {
  id: "transaction-1",
  type: "purchase",
  collectionEntryId: "copy-1",
  cardId: "card-darkrai",
  externalId: "dp24",
  cardName: "Darkrai",
  tcg: "pokemon",
  quantity: 1,
  amount: 20,
  currency: "CAD",
  platform: "Local card shop",
  date: "2020-01-02T12:00:00.000Z",
};

test("purchase price requests retain copy finish, condition, and language", () => {
  assert.deepEqual(purchasePriceItems(collections, [transaction]), [
    {
      tcg: "pokemon",
      externalId: "dp24",
      finishCode: "non-holo",
      condition: "Near Mint",
      language: "English",
    },
  ]);
});

test("cost-basis coverage reports costed copies and untracked value", () => {
  const mixed = structuredClone(collections);
  mixed[0]!.cards.push({
    ...mixed[0]!.cards[0]!,
    id: "copy-2",
    quantity: 2,
    price: 12,
    copies: [
      { ...mixed[0]!.cards[0]!.copies[0]!, id: "copy-2" },
      { ...mixed[0]!.cards[0]!.copies[0]!, id: "copy-3" },
    ],
  });
  assert.deepEqual(purchaseCostCoverage(mixed, [transaction]), {
    totalCopies: 3,
    costedCopies: 1,
    missingCopies: 2,
    coveragePercent: (1 / 3) * 100,
    untrackedMarketValue: 24,
    cardsMissingCosts: 1,
  });
});

test("linked purchase fields win over legacy copy cost", () => {
  const lots = buildPurchasePerformanceLots(collections, [transaction], []);
  assert.equal(lots.length, 1);
  assert.deepEqual(lots[0], {
    id: "copy-1",
    cardName: "Darkrai",
    setName: "DP Black Star Promos",
    imageUrl: undefined,
    paidAmount: 20,
    paidCurrency: "CAD",
    purchasedAt: "2020-01-02T12:00:00.000Z",
    source: "Local card shop",
    currentValue: 31,
    currentCurrency: "USD",
  });
});

test("purchase-date and current rates produce a normalized return", () => {
  const lots = buildPurchasePerformanceLots(collections, [transaction], []);
  const converted = convertPurchasePerformanceLots(lots, (source, date) => {
    if (source === "CAD" && date?.startsWith("2020-01-02")) return 0.77;
    if (source === "USD" && date === undefined) return 1;
    return undefined;
  });
  assert.equal(converted.length, 1);
  assert.equal(converted[0].paidInDisplayCurrency, 15.4);
  assert.equal(converted[0].valueInDisplayCurrency, 31);
  assert.equal(converted[0].gain, 15.6);
  assert.ok(Math.abs(converted[0].returnPercent - 101.2987) < 0.001);
});

test("a copy's original acquisition currency survives without a linked transaction", () => {
  const owned = structuredClone(collections);
  const copy = owned[0]!.cards[0]!.copies[0]!;
  copy.acquisitionPrice = 20;
  copy.acquisitionCurrency = "CAD";
  const lots = buildPurchasePerformanceLots(owned, [], []);
  assert.equal(lots[0]?.paidAmount, 20);
  assert.equal(lots[0]?.paidCurrency, "CAD");
  assert.equal(lots[0]?.currentCurrency, "USD");
});

test("legacy acquisition amounts without a currency remain unknown and never enter USD returns or inferred sale costs", () => {
  const owned = structuredClone(collections);
  const copy = owned[0]!.cards[0]!.copies[0]!;
  copy.acquisitionPrice = 100;
  delete copy.acquisitionCurrency;
  const lots = buildPurchasePerformanceLots(owned, [], []);
  assert.equal(lots[0]?.paidAmount, 100);
  assert.equal(lots[0]?.paidCurrency, UNKNOWN_CURRENCY);
  assert.deepEqual(
    convertPurchasePerformanceLots(lots, () => 1),
    [],
  );
  assert.equal(purchaseCostCoverage(owned, []).costedCopies, 0);
  assert.equal(inferredSaleCost(copy, "USD"), undefined);
  assert.equal(
    formatMoney(100, { currency: UNKNOWN_CURRENCY }),
    "100.00 · Currency unknown",
  );
});

test("a sale may infer only a matching explicitly recorded acquisition currency", () => {
  assert.equal(
    inferredSaleCost(
      { acquisitionPrice: 20, acquisitionCurrency: "CAD" },
      "USD",
    ),
    undefined,
  );
  assert.equal(
    inferredSaleCost(
      { acquisitionPrice: 20, acquisitionCurrency: "CAD" },
      "CAD",
    ),
    20,
  );
});

test("an unavailable foreign quote cannot relabel the stored USD market value", () => {
  const lots = buildPurchasePerformanceLots(
    collections,
    [transaction],
    [
      {
        tcg: "pokemon",
        externalId: "dp24",
        finishCode: "non-holo",
        condition: "Near Mint",
        language: "English",
        key: "ignored",
        currency: "CAD",
        cached: true,
        error: "Provider unavailable",
      },
    ],
  );
  assert.equal(lots[0]?.currentValue, 31);
  assert.equal(lots[0]?.currentCurrency, "USD");
});

test("a copy with no market quote does not borrow its printing group's value for returns", () => {
  const owned = structuredClone(collections);
  delete owned[0]!.cards[0]!.copies[0]!.price;
  owned[0]!.cards[0]!.price = 99;
  const lots = buildPurchasePerformanceLots(owned, [transaction], []);
  assert.equal(lots[0]?.currentValue, undefined);
  assert.deepEqual(
    convertPurchasePerformanceLots(lots, () => 1),
    [],
  );
});
