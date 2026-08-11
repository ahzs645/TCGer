/**
 * The portfolio conversions, against the fixtures that are actually in the wild.
 *
 * The risk this covers is the same one the collection conversion had: a shape
 * that is really stored converts wrongly, and a returning visitor's decks,
 * wishlists, trades or sealed inventory come back altered — or come back at all
 * but in the wrong order, which on these pages is the difference between "my
 * new deck" and "where did it go".
 *
 * So the round trips below run over `demo-portfolio.ts` itself rather than toy
 * objects, and assert deep equality: `assert.deepEqual` distinguishes an absent
 * optional key from one set to `undefined`, which is exactly the distinction
 * `rules` and `cardData` carry.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { isEntityId } from "@tcg/api-types";
import {
  DEMO_DECKS,
  DEMO_SEALED_PRODUCTS,
  DEMO_TRADES,
} from "@/lib/data/demo-portfolio";
import type { DemoWishlist } from "@/stores/demo-store";
import {
  toDeckRows,
  toDemoDecks,
  toDemoSealed,
  toDemoTrades,
  toDemoWishlists,
  toSealedRows,
  toTradeRows,
  toWishlistRows,
} from "./legacy-portfolio-rows";
import {
  LocalPortableDb,
  WISHLIST_TABLES,
  emptySnapshot,
} from "./local-portable-db";

/**
 * A wishlist carrying every shape that has to survive: a card with no payload
 * at all (what `seedWishlists` writes), a card whose local catalog id differs
 * from the printing id enrichment attached, and a saved rule.
 */
function wishlistFixture(): DemoWishlist[] {
  return [
    {
      id: "wl-1",
      name: "Must-Have Staples",
      description: "Key staples across all games",
      color: "#f59e0b",
      createdAt: "2026-01-01T00:00:00.000Z",
      cards: [
        {
          id: "wc-1",
          cardId: "ygo-6",
          name: "Ash Blossom & Joyous Spring",
          tcg: "yugioh",
          setCode: "MAMA-EN044",
          setName: "Magnificent Mavens",
          rarity: "Ultra Rare",
          addedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "wc-2",
          cardId: "pkm-1",
          name: "Charizard ex",
          tcg: "pokemon",
          setCode: "OBF-125",
          setName: "Obsidian Flames",
          rarity: "Special Art Rare",
          addedAt: "2026-01-02T00:00:00.000Z",
          cardData: {
            externalId: "sv3-125",
            tcg: "pokemon",
            name: "Charizard ex",
            setCode: "sv3",
            setName: "Obsidian Flames",
            rarity: "Special Illustration Rare",
            collectorNumber: "125",
            imageUrl: "https://example.invalid/charizard.png",
            dexEntries: [{ number: 6, name: "Charizard" }],
          },
        },
      ],
    },
    {
      id: "wl-2",
      name: "Prismatic Evolutions",
      description: "",
      color: "#8b5cf6",
      createdAt: "2026-01-03T00:00:00.000Z",
      cards: [],
      rules: [
        {
          id: "wr-1",
          type: "set",
          tcg: "pokemon",
          setCode: "sv8pt5",
          setName: "Prismatic Evolutions",
          includeAllPrintings: true,
          autoSync: true,
          lastSyncedAt: "2026-01-04T12:00:00.000Z",
          lastMatchCount: 180,
          createdAt: "2026-01-03T00:00:00.000Z",
          updatedAt: "2026-01-04T12:00:00.000Z",
        },
      ],
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Round trips                                                        */
/* ------------------------------------------------------------------ */

test("wishlists survive the round trip through rows", () => {
  const before = wishlistFixture();
  assert.deepEqual(toDemoWishlists(toWishlistRows(before)), before);
});

test("decks survive the round trip through rows", () => {
  assert.deepEqual(toDemoDecks(toDeckRows(DEMO_DECKS)), DEMO_DECKS);
});

test("trades survive the round trip through rows", () => {
  assert.deepEqual(toDemoTrades(toTradeRows(DEMO_TRADES)), DEMO_TRADES);
});

test("sealed inventory survives the round trip through rows", () => {
  assert.deepEqual(
    toDemoSealed(toSealedRows(DEMO_SEALED_PRODUCTS)),
    DEMO_SEALED_PRODUCTS,
  );
});

/* ------------------------------------------------------------------ */
/*  Identity                                                           */
/* ------------------------------------------------------------------ */

test("ids that already exist are preserved, never re-minted", () => {
  const rows = toWishlistRows(wishlistFixture());
  assert.deepEqual(
    rows.wishlists.map((row) => row._id),
    ["wl-1", "wl-2"],
  );
  assert.deepEqual(
    rows.wishlistCards.map((row) => row._id),
    ["wc-1", "wc-2"],
  );
  assert.deepEqual(
    rows.wishlistRules.map((row) => row._id),
    ["wr-1"],
  );
  assert.deepEqual(
    toDeckRows(DEMO_DECKS).decks.map((row) => row._id),
    DEMO_DECKS.map((deck) => deck.id),
  );
  assert.deepEqual(
    toTradeRows(DEMO_TRADES).trades.map((row) => row._id),
    DEMO_TRADES.map((trade) => trade.id),
  );
  assert.deepEqual(
    toSealedRows(DEMO_SEALED_PRODUCTS).sealedInventory.map((row) => row._id),
    DEMO_SEALED_PRODUCTS.map((product) => product.id),
  );
});

test("rows that never had an id get a promotion-safe one", () => {
  // Deck and trade cards are positional value objects in the shipped shape;
  // there is nothing to preserve, so they are minted rather than invented.
  const deckCards = toDeckRows(DEMO_DECKS).deckCards;
  assert.ok(deckCards.length > 0);
  assert.ok(deckCards.every((row) => isEntityId(row._id)));

  const tradeCards = toTradeRows(DEMO_TRADES).tradeCards;
  assert.ok(tradeCards.length > 0);
  assert.ok(tradeCards.every((row) => isEntityId(row._id)));
  assert.equal(
    new Set(tradeCards.map((row) => row._id)).size,
    tradeCards.length,
  );
});

test("the local catalog id is kept only when it is a second identity", () => {
  const rows = toWishlistRows(wishlistFixture());
  const [plain, enriched] = rows.wishlistCards;
  // Never enriched: the demo card id *is* the external id, so no extra column.
  assert.equal(plain.externalId, "ygo-6");
  assert.equal(plain.localCardId, undefined);
  assert.equal(plain.cardData, undefined);
  // Enriched: the printing id is the identity, the demo id is what every local
  // ownership check still compares against.
  assert.equal(enriched.externalId, "sv3-125");
  assert.equal(enriched.localCardId, "pkm-1");
  assert.equal(enriched.imageUrl, "https://example.invalid/charizard.png");
});

/* ------------------------------------------------------------------ */
/*  Order and queryability                                             */
/* ------------------------------------------------------------------ */

test("a row inserted later sorts ahead of every converted one", async () => {
  const db = new LocalPortableDb({
    ...emptySnapshot(),
    ...toDeckRows(DEMO_DECKS),
  });
  const now = Date.now();
  await db.insert("decks", {
    userId: "demo-user-001",
    name: "Brand New Brew",
    tcg: "magic",
    isPublic: false,
    createdAt: now,
    updatedAt: now,
  });
  const decks = toDemoDecks({
    decks: db.snapshot().decks,
    deckCards: db.snapshot().deckCards,
  });
  assert.equal(decks[0].name, "Brand New Brew");
  assert.equal(decks.length, DEMO_DECKS.length + 1);
  // ...and everything else keeps the order it was seeded in.
  assert.deepEqual(decks.slice(1), DEMO_DECKS);
});

test("converted rows are reachable through the declared indexes", async () => {
  const rows = toWishlistRows(wishlistFixture());
  const db = new LocalPortableDb({ ...emptySnapshot(), ...rows });

  const cards = await db.query("wishlistCards", "by_wishlist", {
    wishlistId: "wl-1",
  });
  assert.equal(cards.length, 2);

  const byPrinting = await db.query(
    "wishlistCards",
    "by_wishlist_external_tcg",
    { wishlistId: "wl-1", externalId: "sv3-125", tcg: "pokemon" },
  );
  assert.equal(byPrinting.length, 1);

  const rules = await db.query("wishlistRules", "by_wishlist", {
    wishlistId: "wl-2",
  });
  assert.equal(rules.length, 1);

  // Deleting a wishlist and its children is one transaction over these tables.
  await db.transaction(WISHLIST_TABLES, async () => {
    for (const card of cards) await db.delete("wishlistCards", card._id);
    await db.delete("wishlists", "wl-1");
  });
  assert.equal(db.normalizeId("wishlists", "wl-1"), null);
  assert.equal(db.snapshot().wishlistCards.length, 0);
});
