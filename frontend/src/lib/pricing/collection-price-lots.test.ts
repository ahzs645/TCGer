import assert from "node:assert/strict";
import test from "node:test";
import type { CollectionCard } from "@tcg/api-types";

import {
  collectionPriceLots,
  trackedPriceLookupKey,
} from "./collection-price-lots";

const card = {
  id: "row",
  cardId: "card",
  externalId: "ABC-123",
  name: "Test Card",
  tcg: "magic",
  quantity: 4,
  price: 2,
  copies: [
    { id: "1", finishCode: "nonfoil", price: 2, tags: [] },
    {
      id: "2",
      finishCode: "foil",
      finishLabel: "Traditional Foil",
      price: 5,
      tags: [],
    },
    { id: "3", isFoil: true, price: 7, tags: [] },
    { id: "4", finishCode: "etched", price: 9, tags: [] },
  ],
} satisfies CollectionCard;

test("separates collection quantities and stored prices by finish", () => {
  assert.deepEqual(collectionPriceLots(card), [
    {
      finishCode: "nonfoil",
      finishLabel: "Non-Foil",
      quantity: 1,
      storedPrice: 2,
    },
    {
      finishCode: "foil",
      finishLabel: "Traditional Foil",
      quantity: 2,
      storedPrice: 6,
    },
    {
      finishCode: "etched",
      finishLabel: "Etched Foil",
      quantity: 1,
      storedPrice: 9,
    },
  ]);
});

test("includes finish in the tracked lookup key", () => {
  assert.equal(
    trackedPriceLookupKey("Magic", "ABC-123", "Foil"),
    "magic:abc-123:foil",
  );
});
