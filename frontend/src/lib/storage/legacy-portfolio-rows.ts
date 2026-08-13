/**
 * The demo's remaining nested slices → portable rows, and back.
 *
 * The collection got this treatment first (`legacy-collection-rows.ts`) because
 * its rules had drifted against a server that implemented them differently.
 * These four have no such counterpart — nothing on the hosted side implements
 * "the demo's wishlists" — so the reason for moving them is the other one: the
 * local runtime is the only copy of this data on a PWA or a desktop build, and
 * a nested array cannot back the portable contract, cannot be written a row at
 * a time, and cannot be queried through an index.
 *
 * Three properties every function here has to hold, all of them learned from
 * the collection conversion:
 *
 * 1. **Ids are preserved, never re-minted.** A wishlist id is in the REST
 *    contract (`/wishlists/:id`) and a wishlist card id is what the DELETE
 *    route addresses. Deck, trade and sealed ids are what their pages select
 *    on. Only rows that never had an id — deck cards and trade cards, which
 *    are positional value objects in the shipped shape — get one, from
 *    `entityId()`.
 * 2. **The round trip is lossless.** `toDemo*(to*Rows(x))` must deep-equal `x`,
 *    including the absence of optional keys: `assert.deepEqual` distinguishes
 *    `{ rules: undefined }` from `{}`, and so does the code that reads them.
 * 3. **Order is preserved.** The demo's lists have a direction — wishlists
 *    append, decks/trades/sealed prepend — and `_creationTime` is assigned so
 *    that the ordered read below reproduces it, with every seeded row strictly
 *    older than anything `insert()` will mint later.
 */

import type {
  DeckCardRow,
  DeckRow,
  SealedInventoryRow,
  TradeCardRow,
  TradeRow,
  WishlistCardRow,
  WishlistRow,
  WishlistRuleRow,
  AddWishlistCardInput,
} from "@tcg/api-types";
import type {
  DeckSnapshot,
  SealedSnapshot,
  TradeSnapshot,
  WishlistSnapshot,
} from "./local-portable-db";
import { LOCAL_USER_ID } from "./legacy-collection-rows";
import type {
  DemoWishlist,
  DemoWishlistCard,
  DemoWishlistRule,
} from "@/stores/demo-store";
import type {
  Deck,
  DeckCard,
  SealedProduct,
  Trade,
  TradeCard,
} from "@/lib/data/demo-portfolio";

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

function epoch(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

/** `2025-03-18` — the calendar-day form the demo's fixtures are written in. */
function calendarDay(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function stripHash(color: string | undefined): string | undefined {
  if (!color) return undefined;
  return color.replace(/^#/, "");
}

function withHash(colorHex: string | undefined, fallback: string): string {
  return colorHex ? `#${colorHex}` : fallback;
}

/**
 * Drop keys whose value is `undefined`.
 *
 * A row column that was never set must come back as an *absent* key, not a
 * present one holding `undefined`: the shipped shape omits it, `deepEqual`
 * distinguishes the two, and so does anything doing `"query" in rule`.
 */
function compact<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

/**
 * `_creationTime` for a list that reads **oldest first** — the order a
 * seeded array is already in, when new entries are appended to the end.
 *
 * Every value lands strictly below `now`, so a row inserted afterwards (which
 * takes `Date.now()`) sorts after all of them even if it arrives in the same
 * millisecond.
 */
function ascendingAt(now: number, count: number, index: number): number {
  return now - (count - index);
}

/**
 * `_creationTime` for a list that reads **newest first** — decks, trades and
 * sealed product, whose pages put the most recent entry at the top.
 */
function descendingAt(now: number, index: number): number {
  return now - (index + 1);
}

const DEFAULT_COLOR = "#3b82f6";

/**
 * The row id for a child that had none in the shipped shape.
 *
 * Deck cards and trade cards are positional value objects — `{ name, quantity,
 * rarity, type }`, no id anywhere — so there is nothing to preserve. Derived
 * from the parent and the position rather than minted with `entityId()`, for
 * the same reason `cardRowId` is deterministic in the collection conversion:
 * these lists are re-converted from the fixtures on every boot, and a minted id
 * would make the same seeded card a different row each time. Nothing mutates a
 * child list in place today; a child added later goes through `insert()` and
 * gets a minted id like every other locally created row.
 */
function childRowId(parentId: string, kind: string, index: number): string {
  return `${parentId}:${kind}:${index}`;
}

/* ------------------------------------------------------------------ */
/*  Wishlists                                                          */
/* ------------------------------------------------------------------ */

/**
 * The identity columns come from `cardData` when there is one; the display
 * columns come from the card itself.
 *
 * They are not always the same, and the difference is load-bearing: a seeded
 * card's own `setCode` is the demo's routable `OBF-125` while the payload's is
 * the provider's `sv3`, and `toWishlistCard` in the demo adapter reads both.
 * Taking either from the wrong side loses information the shipped shape kept.
 */
function wishlistCardRow(
  card: DemoWishlistCard,
  wishlistId: string,
  now: number,
): WishlistCardRow {
  const data = card.cardData;
  const addedAt = epoch(card.addedAt, now);
  const externalId = data?.externalId ?? card.cardId;
  const row: WishlistCardRow = {
    _id: card.id,
    _creationTime: addedAt,
    wishlistId,
    externalId,
    tcg: card.tcg,
    name: card.name,
    desiredQuantity: card.desiredQuantity,
    baseExternalId: data?.baseExternalId,
    printingKey: data?.printingKey,
    setCode: card.setCode,
    setName: card.setName,
    rarity: card.rarity,
    imageUrl: data?.imageUrl,
    imageUrlSmall: data?.imageUrlSmall,
    collectorNumber: data?.collectorNumber,
    releasedAt: data?.releasedAt,
    language: data?.language,
    notes: data?.notes,
    createdAt: addedAt,
    updatedAt: addedAt,
  };
  // The local catalog id only earns a column when it is genuinely a second
  // identity; on a card that was never enriched it *is* the external id.
  if (card.cardId !== externalId) row.localCardId = card.cardId;
  if (data) row.cardData = data as unknown as Record<string, unknown>;
  return row;
}

function wishlistRuleRow(
  rule: DemoWishlistRule,
  wishlistId: string,
  now: number,
): WishlistRuleRow {
  const created = epoch(rule.createdAt, now);
  return {
    _id: rule.id,
    _creationTime: created,
    wishlistId,
    type: rule.type,
    tcg: rule.tcg,
    query: rule.query,
    setCode: rule.setCode,
    setName: rule.setName,
    includeAllPrintings: rule.includeAllPrintings,
    autoSync: rule.autoSync,
    lastSyncedAt:
      rule.lastSyncedAt === undefined ? undefined : epoch(rule.lastSyncedAt, 0),
    lastMatchCount: rule.lastMatchCount,
    createdAt: created,
    updatedAt: epoch(rule.updatedAt, created),
  };
}

export function toWishlistRows(
  wishlists: DemoWishlist[],
  now = Date.now(),
): WishlistSnapshot {
  const wishlistRows: WishlistRow[] = [];
  const cardRows: WishlistCardRow[] = [];
  const ruleRows: WishlistRuleRow[] = [];

  wishlists.forEach((wishlist, index) => {
    const created = epoch(wishlist.createdAt, now);
    wishlistRows.push({
      _id: wishlist.id,
      _creationTime: ascendingAt(now, wishlists.length, index),
      userId: LOCAL_USER_ID,
      name: wishlist.name,
      description: wishlist.description || undefined,
      colorHex: stripHash(wishlist.color),
      createdAt: created,
      updatedAt: created,
    });
    for (const card of wishlist.cards) {
      cardRows.push(wishlistCardRow(card, wishlist.id, now));
    }
    for (const rule of wishlist.rules ?? []) {
      ruleRows.push(wishlistRuleRow(rule, wishlist.id, now));
    }
  });

  return {
    wishlists: wishlistRows,
    wishlistCards: cardRows,
    wishlistRules: ruleRows,
  };
}

export function toDemoWishlistCard(row: WishlistCardRow): DemoWishlistCard {
  const card: DemoWishlistCard = {
    id: row._id,
    cardId: row.localCardId ?? row.externalId,
    name: row.name,
    tcg: row.tcg as DemoWishlistCard["tcg"],
    setCode: row.setCode ?? "",
    setName: row.setName ?? "",
    rarity: row.rarity ?? "",
    addedAt: iso(row.createdAt),
  };
  if (row.desiredQuantity !== undefined) {
    card.desiredQuantity = row.desiredQuantity;
  }
  // Absent, not empty: `catalogLookupForCard` and `toWishlistCard` both branch
  // on whether a payload was ever supplied.
  if (row.cardData) {
    card.cardData = row.cardData as unknown as AddWishlistCardInput;
  }
  return card;
}

export function toDemoWishlistRule(row: WishlistRuleRow): DemoWishlistRule {
  return compact({
    id: row._id,
    type: row.type,
    tcg: row.tcg as DemoWishlistRule["tcg"],
    query: row.query,
    setCode: row.setCode,
    setName: row.setName,
    includeAllPrintings: row.includeAllPrintings,
    autoSync: row.autoSync,
    lastSyncedAt:
      row.lastSyncedAt === undefined ? undefined : iso(row.lastSyncedAt),
    lastMatchCount: row.lastMatchCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });
}

/** Rebuild the nested read model. Regenerated after every mutation, never edited. */
export function toDemoWishlists(rows: WishlistSnapshot): DemoWishlist[] {
  const cardsByWishlist = new Map<string, DemoWishlistCard[]>();
  for (const row of rows.wishlistCards) {
    const list = cardsByWishlist.get(row.wishlistId);
    const card = toDemoWishlistCard(row);
    if (list) list.push(card);
    else cardsByWishlist.set(row.wishlistId, [card]);
  }
  const rulesByWishlist = new Map<string, DemoWishlistRule[]>();
  for (const row of rows.wishlistRules) {
    const list = rulesByWishlist.get(row.wishlistId);
    const rule = toDemoWishlistRule(row);
    if (list) list.push(rule);
    else rulesByWishlist.set(row.wishlistId, [rule]);
  }

  return [...rows.wishlists]
    .sort((a, b) => a._creationTime - b._creationTime)
    .map((wishlist) => {
      const rules = rulesByWishlist.get(wishlist._id);
      const nested: DemoWishlist = {
        id: wishlist._id,
        name: wishlist.name,
        description: wishlist.description ?? "",
        color: withHash(wishlist.colorHex, DEFAULT_COLOR),
        cards: cardsByWishlist.get(wishlist._id) ?? [],
        createdAt: iso(wishlist.createdAt),
      };
      // A wishlist that never had rules keeps no `rules` key at all — the
      // shipped shape leaves it absent and the readers distinguish the two.
      if (rules?.length) nested.rules = rules;
      return nested;
    });
}

/* ------------------------------------------------------------------ */
/*  Decks                                                             */
/* ------------------------------------------------------------------ */

function deckCardRow(
  card: DeckCard,
  deckId: string,
  index: number,
  creationTime: number,
): DeckCardRow {
  return {
    _id: childRowId(deckId, "card", index),
    _creationTime: creationTime,
    deckId,
    name: card.name,
    quantity: card.quantity,
    rarity: card.rarity,
    cardType: card.type,
  };
}

export function toDeckRows(decks: Deck[], now = Date.now()): DeckSnapshot {
  const deckRows: DeckRow[] = [];
  const cardRows: DeckCardRow[] = [];

  decks.forEach((deck, index) => {
    const creationTime = descendingAt(now, index);
    const updated = epoch(deck.lastUpdated, creationTime);
    deckRows.push({
      _id: deck.id,
      _creationTime: creationTime,
      userId: LOCAL_USER_ID,
      name: deck.name,
      description: deck.description || undefined,
      tcg: deck.tcg,
      format: deck.format || undefined,
      colorHex: stripHash(deck.color),
      isPublic: false,
      isComplete: deck.isComplete,
      createdAt: creationTime,
      updatedAt: updated,
    });
    deck.cards.forEach((card, position) => {
      cardRows.push(deckCardRow(card, deck.id, position, creationTime));
    });
  });

  return { decks: deckRows, deckCards: cardRows };
}

export function toDemoDecks(rows: DeckSnapshot): Deck[] {
  const cardsByDeck = new Map<string, DeckCard[]>();
  for (const row of rows.deckCards) {
    const card: DeckCard = {
      name: row.name,
      quantity: row.quantity,
      rarity: row.rarity ?? "",
      type: row.cardType ?? "",
    };
    const list = cardsByDeck.get(row.deckId);
    if (list) list.push(card);
    else cardsByDeck.set(row.deckId, [card]);
  }

  return [...rows.decks]
    .sort((a, b) => b._creationTime - a._creationTime)
    .map((deck) => ({
      id: deck._id,
      name: deck.name,
      tcg: deck.tcg,
      format: deck.format ?? "",
      description: deck.description ?? "",
      color: withHash(deck.colorHex, DEFAULT_COLOR),
      cards: cardsByDeck.get(deck._id) ?? [],
      lastUpdated: calendarDay(deck.updatedAt),
      isComplete: deck.isComplete ?? false,
    }));
}

/* ------------------------------------------------------------------ */
/*  Trades                                                            */
/* ------------------------------------------------------------------ */

function tradeCardRow(
  card: TradeCard,
  tradeId: string,
  side: TradeCardRow["side"],
  index: number,
  creationTime: number,
): TradeCardRow {
  return {
    _id: childRowId(tradeId, side, index),
    _creationTime: creationTime,
    tradeId,
    side,
    name: card.name,
    tcg: card.tcg,
    quantity: 1,
    estimatedValue: card.value,
  };
}

export function toTradeRows(trades: Trade[], now = Date.now()): TradeSnapshot {
  const tradeRows: TradeRow[] = [];
  const cardRows: TradeCardRow[] = [];

  trades.forEach((trade, index) => {
    const creationTime = descendingAt(now, index);
    tradeRows.push({
      _id: trade.id,
      _creationTime: creationTime,
      userId: LOCAL_USER_ID,
      partner: trade.partner,
      status: trade.status,
      tradedOn: trade.date,
      createdAt: creationTime,
      updatedAt: creationTime,
    });
    trade.giving.forEach((card, position) => {
      cardRows.push(
        tradeCardRow(card, trade.id, "giving", position, creationTime),
      );
    });
    trade.receiving.forEach((card, position) => {
      cardRows.push(
        tradeCardRow(card, trade.id, "receiving", position, creationTime),
      );
    });
  });

  return { trades: tradeRows, tradeCards: cardRows };
}

export function toDemoTrades(rows: TradeSnapshot): Trade[] {
  const cardsByTrade = new Map<
    string,
    { giving: TradeCard[]; receiving: TradeCard[] }
  >();
  for (const row of rows.tradeCards) {
    let sides = cardsByTrade.get(row.tradeId);
    if (!sides) {
      sides = { giving: [], receiving: [] };
      cardsByTrade.set(row.tradeId, sides);
    }
    sides[row.side].push({
      name: row.name,
      tcg: row.tcg,
      value: row.estimatedValue ?? 0,
    });
  }

  return [...rows.trades]
    .sort((a, b) => b._creationTime - a._creationTime)
    .map((trade) => ({
      id: trade._id,
      partner: trade.partner,
      status: trade.status,
      date: trade.tradedOn,
      giving: cardsByTrade.get(trade._id)?.giving ?? [],
      receiving: cardsByTrade.get(trade._id)?.receiving ?? [],
    }));
}

/* ------------------------------------------------------------------ */
/*  Sealed product                                                    */
/* ------------------------------------------------------------------ */

export function toSealedRows(
  products: SealedProduct[],
  now = Date.now(),
): SealedSnapshot {
  return {
    sealedInventory: products.map((product, index) => {
      const creationTime = descendingAt(now, index);
      return {
        _id: product.id,
        _creationTime: creationTime,
        userId: LOCAL_USER_ID,
        name: product.name,
        tcg: product.tcg,
        productType: product.type,
        setName: product.set || undefined,
        quantity: product.quantity,
        purchasePrice: product.purchasePrice,
        currentValue: product.currentValue,
        purchasedOn: product.purchaseDate,
        createdAt: creationTime,
        updatedAt: creationTime,
      } satisfies SealedInventoryRow;
    }),
  };
}

export function toDemoSealed(rows: SealedSnapshot): SealedProduct[] {
  return [...rows.sealedInventory]
    .sort((a, b) => b._creationTime - a._creationTime)
    .map((row) => ({
      id: row._id,
      name: row.name,
      tcg: row.tcg,
      type: row.productType,
      purchasePrice: row.purchasePrice,
      currentValue: row.currentValue,
      quantity: row.quantity,
      purchaseDate: row.purchasedOn,
      set: row.setName ?? "",
    }));
}
