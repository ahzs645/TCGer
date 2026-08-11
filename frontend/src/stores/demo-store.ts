import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { DEMO_CARDS, type DemoCard } from "@/lib/data/demo-cards";
import { GAME_LABELS } from "@/lib/utils";
import {
  DEMO_DECKS,
  DEMO_SEALED_PRODUCTS,
  DEMO_TRADES,
  type Deck,
  type SealedProduct,
  type Trade,
} from "@/lib/data/demo-portfolio";
import {
  matchCatalogCards,
  type CatalogCardLookup,
} from "@/lib/catalog/catalog-search";
import {
  isCatalogGame,
  type CatalogTcgCode,
} from "@/lib/catalog/catalog-types";
import {
  DEMO_SCHEMA_VERSION,
  DEMO_SLICES,
  createMemoryPersistence,
  type DemoPersistence,
  type DemoSlice,
  type PersistedDemoState,
} from "@/lib/storage/demo-persistence";
import { createDemoPersistence } from "@/lib/storage/demo-db";
import {
  addCopies,
  removeCard as removeCardRule,
  updateEntry,
  type UpdateFields,
} from "@tcg/api-types";
import {
  COLLECTION_TABLES,
  DECK_TABLES,
  LocalPortableDb,
  SEALED_TABLES,
  TRADE_TABLES,
  WISHLIST_TABLES,
  emptySnapshot,
  overlayRows,
  rowsOf,
  type CollectionSnapshot,
  type DeckSnapshot,
  type PortableSnapshot,
  type SealedSnapshot,
  type TradeSnapshot,
  type WishlistSnapshot,
} from "@/lib/storage/local-portable-db";
import {
  cardRowId,
  indexDemoCards,
  toDemoBinders,
  toPortableRows,
  LOCAL_USER_ID,
} from "@/lib/storage/legacy-collection-rows";
import {
  toDeckRows,
  toDemoDecks,
  toDemoSealed,
  toDemoTrades,
  toDemoWishlistRule,
  toDemoWishlists,
  toSealedRows,
  toTradeRows,
  toWishlistRows,
} from "@/lib/storage/legacy-portfolio-rows";
import type {
  AddWishlistCardInput,
  Card,
  CardDataPayload,
  CollectionCardCopy,
  PortableTableName,
  UpdateCardInput,
  TcgCode,
  UserPreferences,
} from "@tcg/api-types";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface DemoBinderCard {
  id: string;
  cardId: string; // references DemoCard.id
  name: string;
  tcg: TcgCode;
  setCode: string;
  setName: string;
  rarity: string;
  condition: string;
  price: number;
  quantity: number;
  addedAt: string;
  cardData?: CardDataPayload;
  copies?: CollectionCardCopy[];
}

export type DemoOwnedCard = Omit<DemoCard, "tcg"> & { tcg: TcgCode };

export interface DemoBinder {
  id: string;
  name: string;
  color: string;
  cards: DemoBinderCard[];
  createdAt: string;
  updatedAt: string;
}

export interface DemoWishlistCard {
  id: string;
  cardId: string;
  name: string;
  tcg: TcgCode;
  setCode: string;
  setName: string;
  rarity: string;
  addedAt: string;
  cardData?: AddWishlistCardInput;
}

interface DemoCopyInput {
  condition?: string;
  language?: string;
  notes?: string;
  price?: number;
  acquisitionPrice?: number;
  serialNumber?: string;
  acquiredAt?: string;
  isFoil?: boolean;
  finishCode?: string;
  finishLabel?: string;
  edition?: string;
  stamp?: string;
  isSealedPromo?: boolean;
  isOversized?: boolean;
  isPeelOff?: boolean;
  isSigned?: boolean;
  isAltered?: boolean;
  gradingCompany?: string;
  gradingScore?: string;
  certNumber?: string;
  storageLocation?: string;
}

interface DemoCardPersistence {
  cardData?: CardDataPayload;
  copy?: DemoCopyInput;
}

export interface DemoWishlistRule {
  id: string;
  type: "name" | "set" | "artist" | "tag";
  tcg?: TcgCode;
  query?: string;
  setCode?: string;
  setName?: string;
  includeAllPrintings: boolean;
  autoSync: boolean;
  lastSyncedAt?: string;
  lastMatchCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DemoWishlist {
  id: string;
  name: string;
  description: string;
  color: string;
  cards: DemoWishlistCard[];
  rules?: DemoWishlistRule[];
  createdAt: string;
}

export interface DemoProfile {
  username: string;
  email: string;
}

/**
 * The starting values for the persisted slices are module constants rather
 * than inline literals so the persistence diff below can compare them by
 * reference: a slice that still holds its default has, by definition, nothing
 * worth writing. `resetDemo()` reuses the same references for the same reason.
 */
const DEFAULT_DEMO_PROFILE: DemoProfile = {
  username: "Demo User",
  email: "demo@tcger.app",
};

const EMPTY_BINDERS: DemoBinder[] = [];
const EMPTY_ROWS: CollectionSnapshot = rowsOf(
  emptySnapshot(),
  COLLECTION_TABLES,
);
const EMPTY_WISHLISTS: DemoWishlist[] = [];
const EMPTY_WISHLIST_ROWS: WishlistSnapshot = rowsOf(
  emptySnapshot(),
  WISHLIST_TABLES,
);

/**
 * The seeded portfolio, as rows, allocated **once**.
 *
 * Identity is the mechanism, not an optimisation: `persistChangedSlices`
 * commits a slice when its reference stops matching the baseline, and both the
 * baseline and the store start out holding exactly these objects. That is what
 * keeps decks, trades and sealed product out of storage until a visitor
 * actually changes one — they are re-seeded from `demo-portfolio.ts` on every
 * boot, so writing them would be storing a copy of a constant.
 */
let seededPortfolio: {
  deckRows: DeckSnapshot;
  tradeRows: TradeSnapshot;
  sealedRows: SealedSnapshot;
  decks: Deck[];
  trades: Trade[];
  sealed: SealedProduct[];
} | null = null;

function seedPortfolio() {
  if (!seededPortfolio) {
    const deckRows = toDeckRows(DEMO_DECKS);
    const tradeRows = toTradeRows(DEMO_TRADES);
    const sealedRows = toSealedRows(DEMO_SEALED_PRODUCTS);
    seededPortfolio = {
      deckRows,
      tradeRows,
      sealedRows,
      decks: toDemoDecks(deckRows),
      trades: toDemoTrades(tradeRows),
      sealed: toDemoSealed(sealedRows),
    };
  }
  return seededPortfolio;
}

/**
 * The row store as it is before anything is read or seeded: an empty
 * collection and wishlist, and the portfolio fixtures.
 *
 * The portfolio is present from the first tick rather than waiting for
 * `init()`, because its pages render straight off the store and used to show
 * the fixtures immediately.
 *
 * This runs at *module evaluation*, which is why the conversions it calls are
 * pure local code: under the Next bundler the `@tcg/api-types` namespace is not
 * populated yet at this point in the graph, and calling into it here fails with
 * a bare "is not a function" that no unit test reproduces (node resolves the
 * package eagerly). `demo-db.ts` states the same rule for itself. Anything
 * needing `entityId()` has to wait until a mutation.
 */
function initialSnapshot(): PortableSnapshot {
  const portfolio = seedPortfolio();
  return {
    ...emptySnapshot(),
    ...portfolio.deckRows,
    ...portfolio.tradeRows,
    ...portfolio.sealedRows,
  };
}

/**
 * The local runtime's storage, and the thing the shared rules run against.
 *
 * Rows are the truth: every mutation below goes through this store, and the
 * nested arrays the UI reads (`binders`, `wishlists`, `decks`, `trades`,
 * `sealed`) are *derived* read models — regenerated after each mutation, never
 * edited — so they cannot drift from the rows the way two hand-written
 * implementations drifted from each other.
 *
 * One store rather than five, because a mutation that spans two tables (a
 * wishlist and its cards) has to be one transaction and a transaction cannot
 * span two stores. Persistence is still split per slice; see
 * `local-portable-db.ts`.
 */
const localDb = new LocalPortableDb(initialSnapshot());

/**
 * Publish the collection rows and the read model derived from them.
 *
 * `cardData` is carried across the rebuild from the previous nested cards:
 * catalog enrichment writes it and the collection's row model does not carry
 * it, so losing it here would drop card art on the next mutation.
 */
let derivedBinders: DemoBinder[] = EMPTY_BINDERS;

function publishCollection(): DemoBinder[] {
  const rows = rowsOf(localDb.snapshot(), COLLECTION_TABLES);
  // Read from the module-level cache rather than the store: the collection
  // actions call this, and reaching back into `useDemoStore` from inside its
  // own initializer makes the store's type circular.
  const next = toDemoBinders(rows, indexDemoCards(derivedBinders));
  derivedBinders = next;
  useDemoStore.setState({ collectionRows: rows, binders: next });
  return next;
}

function publishWishlists(): DemoWishlist[] {
  const rows = rowsOf(localDb.snapshot(), WISHLIST_TABLES);
  const next = toDemoWishlists(rows);
  useDemoStore.setState({ wishlistRows: rows, wishlists: next });
  return next;
}

function publishDecks(): Deck[] {
  const rows = rowsOf(localDb.snapshot(), DECK_TABLES);
  const next = toDemoDecks(rows);
  useDemoStore.setState({ deckRows: rows, decks: next });
  return next;
}

function publishTrades(): Trade[] {
  const rows = rowsOf(localDb.snapshot(), TRADE_TABLES);
  const next = toDemoTrades(rows);
  useDemoStore.setState({ tradeRows: rows, trades: next });
  return next;
}

function publishSealed(): SealedProduct[] {
  const rows = rowsOf(localDb.snapshot(), SEALED_TABLES);
  const next = toDemoSealed(rows);
  useDemoStore.setState({ sealedRows: rows, sealed: next });
  return next;
}

export const DEFAULT_DEMO_PREFERENCES: UserPreferences = {
  showCardNumbers: true,
  showPricing: true,
  enabledYugioh: true,
  enabledMagic: true,
  enabledPokemon: true,
  enabledOnepiece: false,
  enabledLorcana: false,
  enabledDragonball: false,
  defaultGame: null,
  focusedSetOrder: [],
  setCompletionMode: "standard",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

let _idCounter = Date.now();
function uid(): string {
  return `demo-${(++_idCounter).toString(36)}`;
}

function makeDemoCopy(input: DemoCopyInput = {}): CollectionCardCopy {
  return {
    id: uid(),
    condition: input.condition,
    language: input.language,
    notes: input.notes,
    price: input.price,
    acquisitionPrice: input.acquisitionPrice,
    serialNumber: input.serialNumber,
    acquiredAt: input.acquiredAt,
    isFoil: input.isFoil,
    finishCode: input.finishCode,
    finishLabel: input.finishLabel,
    edition: input.edition,
    stamp: input.stamp,
    isSealedPromo: input.isSealedPromo,
    isOversized: input.isOversized,
    isPeelOff: input.isPeelOff,
    isSigned: input.isSigned,
    isAltered: input.isAltered,
    gradingCompany: input.gradingCompany,
    gradingScore: input.gradingScore,
    certNumber: input.certNumber,
    storageLocation: input.storageLocation,
    tags: [],
  };
}

const CONDITIONS = [
  "Near Mint",
  "Lightly Played",
  "Moderately Played",
  "Heavily Played",
];

/**
 * The seed data is generated from a fixed seed so the demo collection is
 * identical on every visit — quantities and conditions used to come from
 * Math.random(), which made the dashboard totals drift between page loads.
 */
const DEMO_SEED = 2024;

/** mulberry32 — a tiny deterministic PRNG returning floats in [0, 1). */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded cards are back-dated across this window so activity looks alive. */
const DEMO_ACTIVITY_WINDOW_DAYS = 42;
const DAY_MS = 24 * 60 * 60 * 1000;

const DECK_COLORS = [
  "#8b5cf6",
  "#3b82f6",
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#6366f1",
];

const BINDER_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#6366f1",
  "#ec4899",
  "#14b8a6",
];

/* ------------------------------------------------------------------ */
/*  Seed data                                                           */
/* ------------------------------------------------------------------ */

function seedBinders(): DemoBinder[] {
  const random = createRandom(DEMO_SEED);
  const seededAt = Date.now();
  const now = new Date(seededAt).toISOString();

  // 1..max, drawn from the seeded stream instead of Math.random().
  const pickQuantity = (max: number) => 1 + Math.floor(random() * max);

  const makeCard = (card: DemoCard, qty = 1): DemoBinderCard => {
    const condition = CONDITIONS[Math.floor(random() * CONDITIONS.length)];
    // Back-date each card so Recent Activity reads as a feed rather than as a
    // single bulk import stamped with today's date.
    const addedAt = new Date(
      seededAt - Math.floor(random() * DEMO_ACTIVITY_WINDOW_DAYS * DAY_MS),
    ).toISOString();
    const printing = splitSeedPrintingCode(card.setCode);
    return {
      id: uid(),
      cardId: card.id,
      name: card.name,
      tcg: card.tcg,
      setCode: card.setCode,
      setName: card.setName,
      rarity: card.rarity,
      condition,
      price: card.price,
      quantity: qty,
      addedAt,
      // Carrying the split printing code lets set completion match the seeded
      // copies against exact printings instead of reporting 0/N.
      cardData: {
        externalId: card.id,
        name: card.name,
        tcg: card.tcg,
        setCode: printing.setCode ?? card.setCode,
        setName: card.setName,
        rarity: card.rarity,
        collectorNumber: printing.collectorNumber,
      },
      copies: Array.from({ length: qty }, () =>
        makeDemoCopy({ condition, price: card.price }),
      ),
    };
  };

  // A binder is only as old as its oldest card and as fresh as its newest.
  const stampBinderDates = (binder: DemoBinder): DemoBinder => {
    const added = binder.cards.map((card) => Date.parse(card.addedAt));
    if (!added.length) return binder;
    return {
      ...binder,
      createdAt: new Date(Math.min(...added)).toISOString(),
      updatedAt: new Date(Math.max(...added)).toISOString(),
    };
  };

  const ygoCards = DEMO_CARDS.filter((c) => c.tcg === "yugioh");
  const mtgCards = DEMO_CARDS.filter((c) => c.tcg === "magic");
  const pkmCards = DEMO_CARDS.filter((c) => c.tcg === "pokemon");

  return [
    {
      id: uid(),
      name: "Main Deck",
      color: "#3b82f6",
      cards: ygoCards.slice(0, 6).map((c) => makeCard(c, pickQuantity(3))),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid(),
      name: "Modern Staples",
      color: "#8b5cf6",
      cards: mtgCards.slice(0, 8).map((c) => makeCard(c, pickQuantity(4))),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid(),
      name: "Scarlet & Violet",
      color: "#ef4444",
      cards: pkmCards.slice(0, 5).map((c) => makeCard(c, pickQuantity(2))),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid(),
      name: "Staples",
      color: "#f59e0b",
      cards: ygoCards.slice(6, 12).map((c) => makeCard(c, pickQuantity(3))),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid(),
      name: "Vintage Box",
      color: "#10b981",
      cards: pkmCards.slice(5, 10).map((c) => makeCard(c, 1)),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid(),
      name: "Commander",
      color: "#6366f1",
      cards: mtgCards.slice(8, 15).map((c) => makeCard(c, pickQuantity(2))),
      createdAt: now,
      updatedAt: now,
    },
  ].map(stampBinderDates);
}

function seedWishlists(): DemoWishlist[] {
  const now = new Date().toISOString();

  const makeWCard = (card: DemoCard): DemoWishlistCard => ({
    id: uid(),
    cardId: card.id,
    name: card.name,
    tcg: card.tcg,
    setCode: card.setCode,
    setName: card.setName,
    rarity: card.rarity,
    addedAt: now,
  });

  return [
    {
      id: uid(),
      name: "Must-Have Staples",
      description: "Key staples across all games",
      color: "#f59e0b",
      cards: [
        makeWCard(DEMO_CARDS[6]), // Ash Blossom
        makeWCard(DEMO_CARDS[20]), // Lightning Bolt
        makeWCard(DEMO_CARDS[41]), // Pikachu VMAX
        makeWCard(DEMO_CARDS[7]), // Nibiru
        makeWCard(DEMO_CARDS[21]), // Counterspell
        makeWCard(DEMO_CARDS[11]), // Pot of Prosperity
        makeWCard(DEMO_CARDS[42]), // Mew ex
        makeWCard(DEMO_CARDS[8]), // Infinite Impermanence
        makeWCard(DEMO_CARDS[22]), // Swords to Plowshares
        makeWCard(DEMO_CARDS[10]), // Effect Veiler
        makeWCard(DEMO_CARDS[50]), // Boss's Orders
        makeWCard(DEMO_CARDS[9]), // Called by the Grave
      ],
      createdAt: now,
    },
    {
      id: uid(),
      name: "Scarlet & Violet Chase Cards",
      description: "Chase cards from Scarlet & Violet era",
      color: "#ef4444",
      cards: [
        makeWCard(DEMO_CARDS[40]), // Charizard ex
        makeWCard(DEMO_CARDS[46]), // Miraidon ex
        makeWCard(DEMO_CARDS[47]), // Koraidon ex
        makeWCard(DEMO_CARDS[44]), // Iono
        makeWCard(DEMO_CARDS[45]), // Gardevoir ex
        makeWCard(DEMO_CARDS[49]), // Arcanine ex
        makeWCard(DEMO_CARDS[42]), // Mew ex
        makeWCard(DEMO_CARDS[48]), // Umbreon ex
      ],
      createdAt: now,
    },
    {
      id: uid(),
      name: "Modern Upgrades",
      description: "Cards to upgrade Modern deck",
      color: "#8b5cf6",
      cards: [
        makeWCard(DEMO_CARDS[23]), // Ragavan
        makeWCard(DEMO_CARDS[24]), // Wrenn and Six
        makeWCard(DEMO_CARDS[32]), // Endurance
        makeWCard(DEMO_CARDS[30]), // Solitude
        makeWCard(DEMO_CARDS[31]), // Fury
        makeWCard(DEMO_CARDS[39]), // Grief
        makeWCard(DEMO_CARDS[29]), // Murktide Regent
        makeWCard(DEMO_CARDS[26]), // Prismatic Vista
        makeWCard(DEMO_CARDS[25]), // Force of Negation
        makeWCard(DEMO_CARDS[27]), // Urza's Saga
        makeWCard(DEMO_CARDS[37]), // Mishra's Bauble
        makeWCard(DEMO_CARDS[38]), // Chalice of the Void
      ],
      createdAt: now,
    },
  ];
}

function isSyntheticDemoCardId(value: string): boolean {
  return /^(?:ygo|mtg|pkm)-\d+$/i.test(value);
}

function splitSeedPrintingCode(value: string): {
  setCode?: string;
  collectorNumber?: string;
} {
  const separator = value.lastIndexOf("-");
  if (separator <= 0 || separator === value.length - 1) {
    return { setCode: value || undefined };
  }
  return {
    setCode: value.slice(0, separator),
    collectorNumber: value.slice(separator + 1),
  };
}

function catalogLookupForCard(
  key: string,
  card: DemoBinderCard | DemoWishlistCard,
): CatalogCardLookup {
  const currentSeed = isSyntheticDemoCardId(card.cardId)
    ? DEMO_CARDS.find((candidate) => candidate.id === card.cardId)
    : undefined;
  const seedPrinting = isSyntheticDemoCardId(card.cardId)
    ? splitSeedPrintingCode(card.setCode)
    : {};
  return {
    key,
    externalId: card.cardData?.externalId,
    name: card.cardData?.name ?? currentSeed?.name ?? card.name,
    setCode: card.cardData?.setCode ?? seedPrinting.setCode ?? card.setCode,
    setName: card.cardData?.setName ?? card.setName,
    collectorNumber:
      card.cardData?.collectorNumber ?? seedPrinting.collectorNumber,
    rarity: card.cardData?.rarity ?? card.rarity,
  };
}

function needsCatalogImage(card: DemoBinderCard | DemoWishlistCard): boolean {
  return !card.cardData?.imageUrl && !card.cardData?.imageUrlSmall;
}

function catalogCardData(card: Card): CardDataPayload {
  const { id, ...data } = card;
  return { ...data, externalId: id };
}

function mergeCatalogCardData(
  existing: CardDataPayload | AddWishlistCardInput | undefined,
  card: Card,
): CardDataPayload {
  return {
    ...existing,
    ...catalogCardData(card),
  };
}

/* ------------------------------------------------------------------ */
/*  Persistence                                                         */
/* ------------------------------------------------------------------ */

/* ==================================================================
 *  PERSISTENCE SEAM — the one place a storage backend is named
 * ==================================================================
 *
 * The store no longer knows how it is stored. It talks to a
 * `DemoPersistence` (`@/lib/storage/demo-persistence`) and to nothing else,
 * so swapping the backend is a change to `createDefaultDemoPersistence()`
 * below and to nothing else in this file:
 *
 *     import { createDemoPersistence } from "@/lib/storage/demo-db";
 *
 *     function createDefaultDemoPersistence(): MaybeSyncPersistence {
 *       return createDemoPersistence();
 *     }
 *
 * Two things to know when making that swap:
 *
 *  - Do NOT give the Dexie implementation `hydratesSynchronously`. Leaving
 *    it off is what routes `init()` and `resetDemo()` through the deferred
 *    path documented on those actions, which is the whole point.
 *  - `init()` stops being synchronous at that moment. Anything that calls
 *    it and then reads the store in the same tick — `demo-adapter.ts` does,
 *    on every request — has to `await whenDemoStoreHydrated()` first, or
 *    the first response after a cold load reports an empty collection.
 *    That is a correctness-preserving change (nothing is lost, the seed
 *    lands a tick later), but it is visible.
 *
 * Tests, and any other host, swap at runtime instead via
 * `setDemoPersistence()`.
 */

/**
 * An additive, optional marker on top of the shared contract.
 *
 * `DemoPersistence` says `snapshot()` is only valid once `whenHydrated()`
 * resolves — true for IndexedDB, and pessimistic for a synchronous backend:
 * localStorage has the whole payload in hand before its factory returns.
 * An implementation that sets this flag promises its snapshot is already
 * correct at construction time, which lets the store apply it in the same
 * tick and keeps `init()` synchronous, exactly as it was under
 * `zustand/persist`. An async backend simply omits it.
 */
type MaybeSyncPersistence = DemoPersistence & {
  readonly hydratesSynchronously?: boolean;
};

/**
 * Unchanged from the `zustand/persist` era so a returning visitor's demo
 * collection is read back rather than re-seeded.
 *
 * Stage 0 of the data-layer plan moves this into
 * `@/lib/storage/keys.ts`; it is inline here so this module owns no import
 * that does not exist yet.
 */
const DEMO_STORAGE_KEY = "tcg-demo-store";

/**
 * Deliberately the same envelope shape `zustand/persist` wrote (`{ state }`),
 * with the version field the old payload never had. A payload written here is
 * still readable by the old middleware, an old payload is still readable here,
 * and both are readable by the legacy importer in `@/lib/storage/demo-local.ts`
 * (which keys off `state` and treats a missing `version` as `null`). That is
 * what makes this stage reversible and the next one safe.
 */
interface DemoStorageEnvelope {
  schemaVersion?: unknown;
  state?: unknown;
}

/**
 * Assignment through a `DemoSlice` key needs one cast: for a union key TypeScript
 * narrows the *write* type to the intersection of every slice's value type,
 * which nothing satisfies. Reads are unaffected, so this is the only cast.
 */
function writeSlice(target: object, slice: DemoSlice, value: unknown): void {
  (target as Record<string, unknown>)[slice] = value;
}

/** Every named table holds an array, whatever else the stored object carries. */
function hasRowTables(
  value: unknown,
  tables: readonly PortableTableName[],
): boolean {
  if (!value || typeof value !== "object") return false;
  const rows = value as Record<string, unknown>;
  return tables.every((table) => Array.isArray(rows[table]));
}

/** Loose shape check — a stored payload predates any version field. */
function isPlausibleSlice(slice: DemoSlice, value: unknown): boolean {
  switch (slice) {
    case "collectionRows":
      return hasRowTables(value, COLLECTION_TABLES);
    case "wishlistRows":
      return hasRowTables(value, WISHLIST_TABLES);
    case "deckRows":
      return hasRowTables(value, DECK_TABLES);
    case "tradeRows":
      return hasRowTables(value, TRADE_TABLES);
    case "sealedRows":
      return hasRowTables(value, SEALED_TABLES);
    case "binders":
    case "wishlists":
    case "decks":
    case "trades":
    case "sealed":
      return Array.isArray(value);
    case "profile":
    case "preferences":
      return (
        typeof value === "object" && value !== null && !Array.isArray(value)
      );
    case "initialized":
      return typeof value === "boolean";
  }
}

function pickPersistedSlices(
  source: Record<string, unknown>,
): Partial<PersistedDemoState> | null {
  const picked: Partial<PersistedDemoState> = {};
  let found = false;
  for (const slice of DEMO_SLICES) {
    const value = source[slice];
    if (value === undefined || !isPlausibleSlice(slice, value)) continue;
    writeSlice(picked, slice, value);
    found = true;
  }
  return found ? picked : null;
}

function readStoredDemoState(
  storage: Storage,
): Partial<PersistedDemoState> | null {
  let raw: string | null;
  try {
    raw = storage.getItem(DEMO_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: DemoStorageEnvelope;
  try {
    parsed = JSON.parse(raw) as DemoStorageEnvelope;
  } catch {
    // Never delete a payload we failed to read (plan §5 R1) — report "nothing
    // stored", leave the bytes alone, and let the visitor re-seed in memory.
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  if (
    typeof parsed.schemaVersion === "number" &&
    parsed.schemaVersion > DEMO_SCHEMA_VERSION
  ) {
    // Written by a newer build. Reading it would be guessing; ignore it.
    return null;
  }
  const state = parsed.state;
  if (typeof state !== "object" || state === null) return null;
  return pickPersistedSlices(state as Record<string, unknown>);
}

/**
 * The interim backend for this stage: the same localStorage key, the same
 * data, behind the new interface.
 *
 * It still rewrites its single key on every commit — localStorage has no
 * narrower unit than a key. The slice-level `commit()` calls this receives are
 * what the Dexie implementation turns into per-slice writes; this one only has
 * to stop *losing* them.
 */
function createLocalStoragePersistence(): MaybeSyncPersistence | null {
  if (typeof window === "undefined") return null;
  let storage: Storage;
  try {
    // Reading `window.localStorage` is itself what throws when storage is
    // disabled. A backend that exists but refuses writes (Safari private
    // browsing, an exhausted quota) is handled in `commit()` instead.
    storage = window.localStorage;
    if (!storage) return null;
  } catch {
    return null;
  }

  let state = readStoredDemoState(storage);
  let warned = false;

  return {
    hydratesSynchronously: true,
    whenHydrated: () => Promise.resolve(),
    snapshot: () => state,
    commit: (changes) => {
      state = { ...(state ?? {}), ...changes };
      try {
        storage.setItem(
          DEMO_STORAGE_KEY,
          JSON.stringify({ schemaVersion: DEMO_SCHEMA_VERSION, state }),
        );
      } catch {
        // Quota, most likely. The demo keeps running against the in-memory
        // copy — degraded, never broken — and says so once.
        if (!warned) {
          warned = true;
          console.warn(
            "[demo-store] could not persist demo state; continuing in memory",
          );
        }
      }
    },
    clear: () => {
      state = null;
      try {
        storage.removeItem(DEMO_STORAGE_KEY);
      } catch {
        /* nothing to do — the in-memory copy is already empty */
      }
      return Promise.resolve();
    },
  };
}

function createDefaultDemoPersistence(): MaybeSyncPersistence {
  // Dexie. Deliberately NOT marked `hydratesSynchronously`: IndexedDB reads are
  // async, so init()/resetDemo() must take the deferred path and wait rather
  // than deciding to seed over a collection that has merely not loaded yet.
  //
  // createDemoPersistence() already falls back to the in-memory contract when
  // there is no window (SSR/prerender) or IndexedDB is unusable (private
  // browsing, sandboxed iframe), so the demo keeps working without storage.
  return createDemoPersistence();
}

/** The persisted slices as they are before anything is stored or seeded. */
function initialPersistedState(): PersistedDemoState {
  const portfolio = seedPortfolio();
  return {
    initialized: false,
    profile: DEFAULT_DEMO_PROFILE,
    preferences: DEFAULT_DEMO_PREFERENCES,
    collectionRows: EMPTY_ROWS,
    wishlistRows: EMPTY_WISHLIST_ROWS,
    deckRows: portfolio.deckRows,
    tradeRows: portfolio.tradeRows,
    sealedRows: portfolio.sealedRows,
    binders: EMPTY_BINDERS,
    wishlists: EMPTY_WISHLISTS,
    decks: portfolio.decks,
    trades: portfolio.trades,
    sealed: portfolio.sealed,
  };
}

let persistence: MaybeSyncPersistence = createDefaultDemoPersistence();

/**
 * What is believed to be on disk, by reference. A slice is committed only when
 * the store's value stops being the value we last wrote (or last read), which
 * is also what keeps the portfolio out of storage: `init()` and `resetDemo()`
 * assign the very `seedPortfolio()` row objects this baseline starts with, so
 * they only ever differ once an action has built new ones from them.
 */
let persistBaseline: PersistedDemoState = initialPersistedState();

/** Set while the store is being written *from* storage, so it is not written back. */
let suppressPersist = false;

/** Read synchronously by `init()`/`resetDemo()`; see the note on those actions. */
let hydrated = false;

let hydrationPromise: Promise<void> = Promise.resolve();

/** Slices mutated before hydration landed. They win over the stored value. */
const preHydrationDirty = new Set<DemoSlice>();

/** Commit every slice whose reference no longer matches what was last written. */
function persistChangedSlices(state: PersistedDemoState): void {
  if (suppressPersist) return;
  let changes: Partial<PersistedDemoState> | null = null;
  for (const slice of DEMO_SLICES) {
    if (state[slice] === persistBaseline[slice]) continue;
    changes ??= {};
    writeSlice(changes, slice, state[slice]);
    writeSlice(persistBaseline, slice, state[slice]);
    if (!hydrated) preHydrationDirty.add(slice);
  }
  if (!changes) return;
  try {
    persistence.commit(changes);
  } catch {
    // An implementation is not supposed to throw. If one does, the demo keeps
    // running on the in-memory store rather than taking the app down with it.
  }
}

function applyToStore(patch: Partial<PersistedDemoState>): void {
  suppressPersist = true;
  try {
    useDemoStore.setState(patch as Partial<DemoState>);
  } finally {
    suppressPersist = false;
  }
}

function applyHydratedSnapshot(): void {
  let snapshot: Partial<PersistedDemoState> | null = null;
  try {
    snapshot = persistence.snapshot();
  } catch {
    snapshot = null;
  }
  hydrated = true;

  if (snapshot) {
    const current = useDemoStore.getState();
    const patch: Partial<PersistedDemoState> = {};
    let changed = false;
    for (const slice of DEMO_SLICES) {
      // A write that landed while the read was in flight is newer than the
      // read, so it wins — the reference's `preHydrationOps` buffer, inverted.
      if (preHydrationDirty.has(slice)) continue;
      let stored = snapshot[slice];
      if (stored === undefined || stored === current[slice]) continue;
      if (slice === "preferences") {
        // A payload written by an older build predates any preference added
        // since, and the persistence layer validates this slice as "an object"
        // only — it cannot fill the gaps without importing this module and
        // creating a cycle. Merging over the defaults here means a missing
        // field reads as its default rather than undefined, which would
        // otherwise reach `getPreferences()` and the settings UI.
        stored = {
          ...DEFAULT_DEMO_PREFERENCES,
          ...(stored as Partial<UserPreferences>),
        } as PersistedDemoState["preferences"];
      }
      writeSlice(patch, slice, stored);
      writeSlice(persistBaseline, slice, stored);
      changed = true;
    }
    // A stored collection with no `initialized` flag can only have come from a
    // visitor who had one, so treat it as one. Left out of `persistBaseline`
    // on purpose: the flag itself still needs writing.
    if (
      snapshot.initialized === undefined &&
      !preHydrationDirty.has("initialized") &&
      (snapshot.collectionRows !== undefined ||
        snapshot.wishlistRows !== undefined)
    ) {
      patch.initialized = true;
      changed = true;
    }
    // Rows are the truth, so they go into the store that owns them and the
    // read models are derived from them — assigning the nested arrays from the
    // patch would leave the two disagreeing until the next mutation. Only the
    // slices that were actually applied are overlaid: the rest keep whatever
    // the row store already has, which is the seed for the portfolio and a
    // pre-hydration write for anything the visitor touched while the read was
    // in flight.
    const rows = { ...localDb.snapshot() };
    let rowsChanged = false;
    if (patch.collectionRows) {
      overlayRows(rows, patch.collectionRows, COLLECTION_TABLES);
      patch.binders = toDemoBinders(patch.collectionRows);
      derivedBinders = patch.binders;
      rowsChanged = true;
    }
    if (patch.wishlistRows) {
      overlayRows(rows, patch.wishlistRows, WISHLIST_TABLES);
      patch.wishlists = toDemoWishlists(patch.wishlistRows);
      rowsChanged = true;
    }
    if (patch.deckRows) {
      overlayRows(rows, patch.deckRows, DECK_TABLES);
      patch.decks = toDemoDecks(patch.deckRows);
      rowsChanged = true;
    }
    if (patch.tradeRows) {
      overlayRows(rows, patch.tradeRows, TRADE_TABLES);
      patch.trades = toDemoTrades(patch.tradeRows);
      rowsChanged = true;
    }
    if (patch.sealedRows) {
      overlayRows(rows, patch.sealedRows, SEALED_TABLES);
      patch.sealed = toDemoSealed(patch.sealedRows);
      rowsChanged = true;
    }
    if (rowsChanged) localDb.load(rows);
    if (changed) applyToStore(patch);
  }

  // Force a re-commit of anything written before hydration finished: the
  // backend may have been reading, not writing, when those commits arrived.
  for (const slice of preHydrationDirty) {
    writeSlice(persistBaseline, slice, undefined);
  }
  preHydrationDirty.clear();
  persistChangedSlices(useDemoStore.getState());
}

function beginDemoHydration(): void {
  hydrated = false;
  preHydrationDirty.clear();
  const active = persistence;

  if (active.hydratesSynchronously) {
    applyHydratedSnapshot();
    hydrationPromise = Promise.resolve();
    return;
  }

  hydrationPromise = (async () => {
    try {
      await active.whenHydrated();
    } catch {
      // Contract says this never rejects; proceed with nothing loaded anyway.
    }
    // Superseded by `setDemoPersistence()` while the read was in flight.
    if (persistence !== active) return;
    applyHydratedSnapshot();
  })();
}

/**
 * Resolves once the stored snapshot has been read and applied.
 *
 * Anything that branches on the demo looking empty has to await this, or it
 * acts on a store that is only *provisionally* empty. `init()` and
 * `resetDemo()` do it for you; a caller that reads `binders` directly on first
 * paint should await it too.
 */
export function whenDemoStoreHydrated(): Promise<void> {
  return hydrationPromise;
}

/**
 * Replace the persistence backend and re-hydrate from it.
 *
 * The persisted slices are reset to their starting values first, so the store
 * reflects the new backend rather than a blend of it and the old one. Intended
 * for tests and for the Dexie swap described at the top of this section.
 */
export function setDemoPersistence(next: DemoPersistence): void {
  persistence = next;
  persistBaseline = initialPersistedState();
  // The row store is module state and would otherwise survive the swap,
  // leaking one persistence backend's data into the next.
  localDb.load(initialSnapshot());
  derivedBinders = EMPTY_BINDERS;
  applyToStore(initialPersistedState());
  beginDemoHydration();
}

/**
 * The whole seed, as one row snapshot plus the read models derived from it.
 *
 * Built in one go so `init()` and `resetDemo()` can land it in a single
 * `setState`: the portfolio slices are kept out of storage by reference
 * identity, and a second write would break that.
 */
function seededState() {
  const binders = seedBinders();
  const collectionRows = toPortableRows(binders);
  const wishlistRows = toWishlistRows(seedWishlists());
  const portfolio = seedPortfolio();
  localDb.load({
    ...emptySnapshot(),
    ...collectionRows,
    ...wishlistRows,
    ...portfolio.deckRows,
    ...portfolio.tradeRows,
    ...portfolio.sealedRows,
  });
  derivedBinders = binders;
  return {
    initialized: true as const,
    collectionRows,
    binders,
    wishlistRows,
    wishlists: toDemoWishlists(wishlistRows),
    deckRows: portfolio.deckRows,
    decks: portfolio.decks,
    tradeRows: portfolio.tradeRows,
    trades: portfolio.trades,
    sealedRows: portfolio.sealedRows,
    sealed: portfolio.sealed,
  };
}

/** Seed the fixtures, but only if this visitor genuinely has nothing. */
function seedDemoIfEmpty(): void {
  if (useDemoStore.getState().initialized) return;
  useDemoStore.setState(seededState());
}

function resetDemoState(): void {
  // Apply in memory first so the UI turns over in the same tick, with commits
  // suppressed: `DemoPersistence` orders `commit()` against nothing, so a
  // commit issued now could land either side of the `clear()` below. Once the
  // clear has resolved the baseline is reset and the fresh state is committed
  // from scratch — decks/trades/sealed excluded, since they are seeds again.
  applyToStore({
    ...seededState(),
    profile: DEFAULT_DEMO_PROFILE,
    preferences: DEFAULT_DEMO_PREFERENCES,
  });

  const active = persistence;
  void (async () => {
    try {
      await active.clear();
    } catch {
      /* fall through — the in-memory reset already happened */
    }
    if (persistence !== active) return;
    persistBaseline = initialPersistedState();
    persistChangedSlices(useDemoStore.getState());
  })();
}

/* ------------------------------------------------------------------ */
/*  Store interface                                                     */
/* ------------------------------------------------------------------ */

interface DemoState {
  initialized: boolean;
  profile: DemoProfile;
  preferences: UserPreferences;
  /* Rows are the truth; each nested array below it is derived from them after
   * every mutation and never edited. */
  collectionRows: CollectionSnapshot;
  binders: DemoBinder[];
  wishlistRows: WishlistSnapshot;
  wishlists: DemoWishlist[];
  deckRows: DeckSnapshot;
  decks: Deck[];
  tradeRows: TradeSnapshot;
  trades: Trade[];
  sealedRows: SealedSnapshot;
  sealed: SealedProduct[];

  // Lifecycle
  init: () => void;
  resetDemo: () => void;
  enrichCardsFromCatalog: (tcg?: CatalogTcgCode) => Promise<number>;

  // Profile
  updateProfile: (data: Partial<DemoProfile>) => void;
  updatePreferences: (data: Partial<UserPreferences>) => UserPreferences;
  getPreferences: () => UserPreferences;

  // Decks, trades and sealed inventory
  addDeck: (input: {
    name: string;
    tcg: Deck["tcg"];
    format: string;
    description?: string;
  }) => Promise<string>;
  removeDeck: (id: string) => Promise<void>;
  addTrade: (input: {
    partner: string;
    giving: Trade["giving"];
    receiving: Trade["receiving"];
  }) => Promise<string>;
  setTradeStatus: (id: string, status: Trade["status"]) => Promise<void>;
  addSealedProduct: (input: {
    name: string;
    tcg: SealedProduct["tcg"];
    type: string;
    set: string;
    quantity: number;
    purchasePrice: number;
    currentValue: number;
  }) => Promise<string>;
  removeSealedProduct: (id: string) => Promise<void>;

  // Binders
  addBinder: (name: string, color?: string) => Promise<string>;
  removeBinder: (id: string) => Promise<void>;
  renameBinder: (id: string, name: string) => Promise<void>;
  addCardToBinder: (
    binderId: string,
    card: DemoOwnedCard,
    quantity?: number,
    details?: DemoCardPersistence,
  ) => void;
  updateCardInBinder: (
    binderId: string,
    cardOrCopyId: string,
    updates: UpdateCardInput,
  ) => Promise<DemoBinderCard | null>;
  removeCardFromBinder: (
    binderId: string,
    cardInstanceId: string,
  ) => Promise<void>;

  // Wishlists
  addWishlist: (name: string, description?: string) => Promise<string>;
  removeWishlist: (id: string) => Promise<void>;
  addCardToWishlist: (
    wishlistId: string,
    card: DemoOwnedCard,
    cardData?: AddWishlistCardInput,
  ) => Promise<void>;
  removeCardFromWishlist: (
    wishlistId: string,
    cardInstanceId: string,
  ) => Promise<void>;
  addWishlistRule: (
    wishlistId: string,
    rule: Omit<DemoWishlistRule, "id" | "createdAt" | "updatedAt">,
  ) => Promise<DemoWishlistRule | null>;
  updateWishlistRule: (
    wishlistId: string,
    ruleId: string,
    patch: Partial<
      Pick<
        DemoWishlistRule,
        "autoSync" | "includeAllPrintings" | "lastSyncedAt" | "lastMatchCount"
      >
    >,
  ) => Promise<DemoWishlistRule | null>;
  removeWishlistRule: (wishlistId: string, ruleId: string) => Promise<void>;

  // Queries
  isCardInCollection: (cardId: string) => boolean;
  getOwnedQuantity: (cardId: string) => number;
}

/* ------------------------------------------------------------------ */
/*  Store                                                               */
/* ------------------------------------------------------------------ */

export const useDemoStore = create<DemoState>()((set, get) => ({
  initialized: false,
  profile: DEFAULT_DEMO_PROFILE,
  preferences: DEFAULT_DEMO_PREFERENCES,
  collectionRows: EMPTY_ROWS,
  binders: EMPTY_BINDERS,
  wishlistRows: EMPTY_WISHLIST_ROWS,
  wishlists: EMPTY_WISHLISTS,
  deckRows: seedPortfolio().deckRows,
  decks: seedPortfolio().decks,
  tradeRows: seedPortfolio().tradeRows,
  trades: seedPortfolio().trades,
  sealedRows: seedPortfolio().sealedRows,
  sealed: seedPortfolio().sealed,

  /**
   * Seed the demo fixtures on a first visit, and do nothing on a return
   * visit. Callers may fire this on every request; it stays idempotent.
   *
   * The seeding decision is taken on `initialized`, which is false until
   * the stored snapshot has been read. localStorage answers before this
   * module finishes evaluating, so that read is already done here and the
   * seed happens synchronously, as it always did. An asynchronous backend
   * (IndexedDB) does not: for the first few milliseconds the store looks
   * exactly like a first visit, and seeding then would write fresh
   * fixtures over a returning visitor's collection — the entire risk this
   * refactor exists to remove (plan §5 R2).
   *
   * So when hydration is still in flight the decision is deferred rather
   * than taken on provisional state. No component can force the race: the
   * branch below is the only thing that reads `initialized` for this
   * purpose, and it will not read it early.
   */
  init: () => {
    if (!hydrated) {
      void whenDemoStoreHydrated().then(seedDemoIfEmpty);
      return;
    }
    seedDemoIfEmpty();
  },

  /**
   * Throw away whatever the visitor has and rebuild the fixtures.
   *
   * Awaits hydration for the mirror image of `init()`'s reason: a read
   * that resolves *after* the reset would apply the discarded snapshot
   * over the freshly seeded state.
   */
  resetDemo: () => {
    if (!hydrated) {
      void whenDemoStoreHydrated().then(resetDemoState);
      return;
    }
    resetDemoState();
  },

  enrichCardsFromCatalog: async (requestedTcg) => {
    const snapshot = get();
    const lookups = new Map<CatalogTcgCode, CatalogCardLookup[]>();
    const addLookup = (
      key: string,
      card: DemoBinderCard | DemoWishlistCard,
    ) => {
      if (
        !needsCatalogImage(card) ||
        !isCatalogGame(card.tcg) ||
        (requestedTcg && card.tcg !== requestedTcg)
      ) {
        return;
      }
      const gameLookups = lookups.get(card.tcg) ?? [];
      gameLookups.push(catalogLookupForCard(key, card));
      lookups.set(card.tcg, gameLookups);
    };

    for (const binder of snapshot.binders) {
      for (const card of binder.cards) {
        addLookup(`binder:${card.id}`, card);
      }
    }
    for (const wishlist of snapshot.wishlists) {
      for (const card of wishlist.cards) {
        addLookup(`wishlist:${card.id}`, card);
      }
    }
    if (!lookups.size) return 0;

    const matches = new Map<string, Card>();
    await Promise.all(
      Array.from(lookups, async ([game, gameLookups]) => {
        try {
          const gameMatches = await matchCatalogCards(game, gameLookups);
          for (const [key, card] of gameMatches) {
            if (card.imageUrl || card.imageUrlSmall) {
              matches.set(key, card);
            }
          }
        } catch {
          // Demo collections remain usable when IndexedDB is unavailable.
        }
      }),
    );
    if (!matches.size) return 0;

    // The collection's card art lives on the nested read model rather than in
    // rows (`CardRow` has no `cardData`), so enrichment edits the read model
    // and `derivedBinders` is re-pointed at it — otherwise the next collection
    // mutation would rebuild from rows through a stale index and drop the art.
    const enrichedBinders = get().binders.map((binder) => ({
      ...binder,
      cards: binder.cards.map((card) => {
        const match = matches.get(`binder:${card.id}`);
        if (!match || !needsCatalogImage(card)) return card;
        return {
          ...card,
          name: match.name,
          setCode: match.setCode ?? card.setCode,
          setName: match.setName ?? card.setName,
          rarity: match.rarity ?? card.rarity,
          cardData: mergeCatalogCardData(card.cardData, match),
        };
      }),
    }));
    derivedBinders = enrichedBinders;
    set({ binders: enrichedBinders });

    // Wishlist cards *are* rows, so their enrichment is a write to storage.
    const now = Date.now();
    const enrich = localDb.snapshot().wishlistCards.flatMap((row) => {
      const match = matches.get(`wishlist:${row._id}`);
      if (!match || row.imageUrl || row.imageUrlSmall) return [];
      return [[row, match] as const];
    });
    if (!enrich.length) return matches.size;

    await localDb.transaction(["wishlistCards"], async () => {
      for (const [row, match] of enrich) {
        const merged = mergeCatalogCardData(
          row.cardData as AddWishlistCardInput | undefined,
          match,
        );
        const localCardId = row.localCardId ?? row.externalId;
        await localDb.patch("wishlistCards", row._id, {
          externalId: merged.externalId,
          localCardId:
            localCardId === merged.externalId ? undefined : localCardId,
          name: match.name,
          setCode: match.setCode ?? row.setCode,
          setName: match.setName ?? row.setName,
          rarity: match.rarity ?? row.rarity,
          imageUrl: merged.imageUrl,
          imageUrlSmall: merged.imageUrlSmall,
          collectorNumber: merged.collectorNumber ?? row.collectorNumber,
          cardData: merged as unknown as Record<string, unknown>,
          updatedAt: now,
        });
      }
    });
    publishWishlists();
    return matches.size;
  },

  updateProfile: (data) => {
    set((state) => ({
      profile: { ...state.profile, ...data },
    }));
  },

  updatePreferences: (data) => {
    const preferences = {
      ...DEFAULT_DEMO_PREFERENCES,
      ...get().preferences,
      ...data,
    };
    set({ preferences });
    return preferences;
  },

  getPreferences: () => ({
    ...DEFAULT_DEMO_PREFERENCES,
    ...get().preferences,
  }),

  /* ---------- Decks, trades and sealed inventory ----------
   *
   * These four slices have no server-side counterpart that implements them a
   * second time, so — unlike the collection — their mutations are not extracted
   * into `@tcg/api-types`. What they do share with the collection is the
   * storage contract: every write below goes through `PortableDb`, one
   * transaction per mutation, so the *code* is already runtime-independent even
   * though there is currently only one runtime running it.
   */

  addDeck: async ({ name, tcg, format, description }) => {
    const now = Date.now();
    const id = await localDb.insert("decks", {
      userId: LOCAL_USER_ID,
      name,
      tcg,
      format,
      description: description?.trim() || "No description yet.",
      colorHex: DECK_COLORS[
        localDb.snapshot().decks.length % DECK_COLORS.length
      ].replace(/^#/, ""),
      isPublic: false,
      isComplete: false,
      createdAt: now,
      updatedAt: now,
    });
    publishDecks();
    return id;
  },

  removeDeck: async (id) => {
    // The deck's cards go with it; orphaned rows would be invisible and
    // permanent.
    const cards = await localDb.query("deckCards", "by_deck", { deckId: id });
    await localDb.transaction(DECK_TABLES, async () => {
      for (const card of cards) await localDb.delete("deckCards", card._id);
      await localDb.delete("decks", id);
    });
    publishDecks();
  },

  addTrade: async ({ partner, giving, receiving }) => {
    const now = Date.now();
    const id = await localDb.transaction(TRADE_TABLES, async () => {
      const tradeId = await localDb.insert("trades", {
        userId: LOCAL_USER_ID,
        partner,
        status: "pending",
        tradedOn: new Date(now).toISOString().slice(0, 10),
        createdAt: now,
        updatedAt: now,
      });
      for (const [side, cards] of [
        ["giving", giving],
        ["receiving", receiving],
      ] as const) {
        for (const card of cards) {
          await localDb.insert("tradeCards", {
            tradeId,
            side,
            name: card.name,
            tcg: card.tcg,
            quantity: 1,
            estimatedValue: card.value,
          });
        }
      }
      return tradeId;
    });
    publishTrades();
    return id;
  },

  setTradeStatus: async (id, status) => {
    await localDb.patch("trades", id, { status, updatedAt: Date.now() });
    publishTrades();
  },

  addSealedProduct: async ({
    name,
    tcg,
    type,
    set: setName,
    quantity,
    purchasePrice,
    currentValue,
  }) => {
    const now = Date.now();
    const id = await localDb.insert("sealedInventory", {
      userId: LOCAL_USER_ID,
      name,
      tcg,
      productType: type,
      setName,
      quantity,
      purchasePrice,
      currentValue,
      purchasedOn: new Date(now).toISOString().slice(0, 10),
      createdAt: now,
      updatedAt: now,
    });
    publishSealed();
    return id;
  },

  removeSealedProduct: async (id) => {
    await localDb.delete("sealedInventory", id);
    publishSealed();
  },

  // ── Binders ──────────────────────────────────────────────────

  addBinder: async (name, color) => {
    const now = Date.now();
    const id = await localDb.insert("binders", {
      userId: LOCAL_USER_ID,
      kind: "binder",
      name,
      colorHex: (
        color ??
        BINDER_COLORS[localDb.snapshot().binders.length % BINDER_COLORS.length]
      ).replace(/^#/, ""),
      createdAt: now,
      updatedAt: now,
    });
    publishCollection();
    return id;
  },

  removeBinder: async (id) => {
    // The binder's copies go with it; orphaned entries would still be counted
    // by every collection selector.
    const entries = await localDb.query("collectionEntries", "by_binder", {
      binderId: id,
    });
    await localDb.transaction(["binders", "collectionEntries"], async () => {
      for (const entry of entries) {
        await localDb.delete("collectionEntries", entry._id);
      }
      await localDb.delete("binders", id);
    });
    publishCollection();
  },

  renameBinder: async (id, name) => {
    await localDb.patch("binders", id, { name, updatedAt: Date.now() });
    publishCollection();
  },

  addCardToBinder: async (binderId, card, quantity = 1, details) => {
    await addCopies(localDb, {
      userId: LOCAL_USER_ID,
      binderId,
      // The row id is derived from the demo card id, so a card added now and
      // the same card converted from schema 1 land on one row.
      card: {
        tcg: card.tcg,
        externalId: details?.cardData?.externalId ?? card.id,
        printingKey: details?.cardData?.printingKey,
        name: details?.cardData?.name ?? card.name,
        setCode: details?.cardData?.setCode ?? card.setCode,
        setName: details?.cardData?.setName ?? card.setName,
        rarity: details?.cardData?.rarity ?? card.rarity,
        collectorNumber: details?.cardData?.collectorNumber,
        imageUrl: details?.cardData?.imageUrl,
        imageUrlSmall: details?.cardData?.imageUrlSmall,
        language: details?.cardData?.language,
      },
      quantity,
      fields: {
        condition: details?.copy?.condition ?? "Near Mint",
        language: details?.copy?.language,
        notes: details?.copy?.notes,
        price: details?.copy?.price ?? card.price,
        acquisitionPrice: details?.copy?.acquisitionPrice,
        serialNumber: details?.copy?.serialNumber,
        acquiredAt: details?.copy?.acquiredAt,
        isFoil: details?.copy?.isFoil,
        finishCode: details?.copy?.finishCode,
        finishLabel: details?.copy?.finishLabel,
        edition: details?.copy?.edition,
        stamp: details?.copy?.stamp,
        isSealedPromo: details?.copy?.isSealedPromo,
        isOversized: details?.copy?.isOversized,
        isPeelOff: details?.copy?.isPeelOff,
        isSigned: details?.copy?.isSigned,
        isAltered: details?.copy?.isAltered,
        gradingCompany: details?.copy?.gradingCompany,
        gradingScore: details?.copy?.gradingScore,
        certNumber: details?.copy?.certNumber,
        storageLocation: details?.copy?.storageLocation,
      },
    });
    publishCollection();
  },

  updateCardInBinder: async (binderId, cardOrCopyId, updates) => {
    try {
      const entry = await updateEntry(localDb, {
        userId: LOCAL_USER_ID,
        entryId: cardOrCopyId,
        updates: updates as UpdateFields,
      });
      const binders = publishCollection();
      const binder = binders.find(
        (candidate) => candidate.id === entry.binderId,
      );
      return (
        binder?.cards.find((card) =>
          card.copies?.some((copy) => copy.id === entry._id),
        ) ?? null
      );
    } catch {
      // The REST layer turns a null into its own 404; the rules already
      // rejected the request for a reason the caller cannot act on.
      return null;
    }
  },

  removeCardFromBinder: async (binderId, cardInstanceId) => {
    try {
      await removeCardRule(localDb, {
        userId: LOCAL_USER_ID,
        entryId: cardInstanceId,
      });
      publishCollection();
    } catch {
      // Removing something that is not there is not an error worth surfacing.
    }
  },

  // ── Wishlists ────────────────────────────────────────────────
  addWishlist: async (name, description) => {
    const now = Date.now();
    const id = await localDb.insert("wishlists", {
      userId: LOCAL_USER_ID,
      name,
      description: description || undefined,
      colorHex: BINDER_COLORS[
        localDb.snapshot().wishlists.length % BINDER_COLORS.length
      ].replace(/^#/, ""),
      createdAt: now,
      updatedAt: now,
    });
    publishWishlists();
    return id;
  },

  removeWishlist: async (id) => {
    // Cards and rules go with the wishlist. Collected outside the transaction
    // and deleted inside it, the same shape `removeBinder` uses.
    const [cards, rules] = await Promise.all([
      localDb.query("wishlistCards", "by_wishlist", { wishlistId: id }),
      localDb.query("wishlistRules", "by_wishlist", { wishlistId: id }),
    ]);
    await localDb.transaction(WISHLIST_TABLES, async () => {
      for (const card of cards) await localDb.delete("wishlistCards", card._id);
      for (const rule of rules) await localDb.delete("wishlistRules", rule._id);
      await localDb.delete("wishlists", id);
    });
    publishWishlists();
  },

  addCardToWishlist: async (wishlistId, card, cardData) => {
    const wishlist = await localDb.get("wishlists", wishlistId);
    if (!wishlist) return;

    const existing = await localDb.query("wishlistCards", "by_wishlist", {
      wishlistId,
    });
    // Deduplicated on the id the caller used, which for a seeded card is the
    // local catalog's id and not the printing id enrichment later attaches.
    if (existing.some((row) => (row.localCardId ?? row.externalId) === card.id))
      return;

    const now = Date.now();
    const externalId = cardData?.externalId ?? card.id;
    await localDb.insert("wishlistCards", {
      wishlistId,
      externalId,
      localCardId: card.id === externalId ? undefined : card.id,
      tcg: card.tcg,
      // Display columns from the card, identity columns from the payload —
      // they differ for a seeded card and `legacy-portfolio-rows.ts` explains
      // why both are kept.
      name: card.name,
      baseExternalId: cardData?.baseExternalId,
      printingKey: cardData?.printingKey,
      setCode: card.setCode,
      setName: card.setName,
      rarity: card.rarity,
      imageUrl: cardData?.imageUrl,
      imageUrlSmall: cardData?.imageUrlSmall,
      collectorNumber: cardData?.collectorNumber,
      releasedAt: cardData?.releasedAt,
      language: cardData?.language,
      notes: cardData?.notes,
      cardData: cardData as unknown as Record<string, unknown> | undefined,
      createdAt: now,
      updatedAt: now,
    });
    publishWishlists();
  },

  removeCardFromWishlist: async (wishlistId, cardInstanceId) => {
    const row = await localDb.get("wishlistCards", cardInstanceId);
    if (!row || row.wishlistId !== wishlistId) return;
    await localDb.delete("wishlistCards", cardInstanceId);
    publishWishlists();
  },

  addWishlistRule: async (wishlistId, rule) => {
    const wishlist = await localDb.get("wishlists", wishlistId);
    if (!wishlist) return null;

    const now = Date.now();
    const rules = await localDb.query("wishlistRules", "by_wishlist", {
      wishlistId,
    });
    // Re-adding the same rule refreshes it rather than duplicating.
    const existing = rules.find(
      (candidate) =>
        candidate.type === rule.type &&
        candidate.tcg === rule.tcg &&
        candidate.query === rule.query &&
        candidate.setCode === rule.setCode,
    );

    let ruleId: string;
    if (existing) {
      await localDb.patch("wishlistRules", existing._id, {
        ...rule,
        setName: rule.setName ?? existing.setName,
        lastSyncedAt:
          rule.lastSyncedAt === undefined
            ? existing.lastSyncedAt
            : Date.parse(rule.lastSyncedAt),
        updatedAt: now,
      });
      ruleId = existing._id;
    } else {
      ruleId = await localDb.insert("wishlistRules", {
        wishlistId,
        type: rule.type,
        tcg: rule.tcg,
        query: rule.query,
        setCode: rule.setCode,
        setName: rule.setName,
        includeAllPrintings: rule.includeAllPrintings,
        autoSync: rule.autoSync,
        lastSyncedAt:
          rule.lastSyncedAt === undefined
            ? undefined
            : Date.parse(rule.lastSyncedAt),
        lastMatchCount: rule.lastMatchCount,
        createdAt: now,
        updatedAt: now,
      });
    }
    publishWishlists();
    const saved = await localDb.get("wishlistRules", ruleId);
    return saved ? toDemoWishlistRule(saved) : null;
  },

  updateWishlistRule: async (wishlistId, ruleId, patch) => {
    const rule = await localDb.get("wishlistRules", ruleId);
    if (!rule || rule.wishlistId !== wishlistId) return null;
    await localDb.patch("wishlistRules", ruleId, {
      autoSync: patch.autoSync ?? rule.autoSync,
      includeAllPrintings:
        patch.includeAllPrintings ?? rule.includeAllPrintings,
      lastSyncedAt:
        patch.lastSyncedAt === undefined
          ? rule.lastSyncedAt
          : Date.parse(patch.lastSyncedAt),
      lastMatchCount: patch.lastMatchCount ?? rule.lastMatchCount,
      updatedAt: Date.now(),
    });
    publishWishlists();
    const saved = await localDb.get("wishlistRules", ruleId);
    return saved ? toDemoWishlistRule(saved) : null;
  },

  removeWishlistRule: async (wishlistId, ruleId) => {
    const rule = await localDb.get("wishlistRules", ruleId);
    if (!rule || rule.wishlistId !== wishlistId) return;
    await localDb.delete("wishlistRules", ruleId);
    publishWishlists();
  },

  // ── Queries ──────────────────────────────────────────────────
  isCardInCollection: (cardId) => {
    return get().binders.some((b) => b.cards.some((c) => c.cardId === cardId));
  },

  getOwnedQuantity: (cardId) => {
    let total = 0;
    for (const b of get().binders) {
      for (const c of b.cards) {
        if (c.cardId === cardId) total += c.quantity;
      }
    }
    return total;
  },
}));

/* ------------------------------------------------------------------ */
/*  Persistence wiring                                                  */
/* ------------------------------------------------------------------ */

/**
 * One subscription replaces the `persist` middleware. Every action goes
 * through `set`, so every action commits — but only the slices whose value it
 * actually replaced, instead of re-serialising the whole store the way
 * `persist` did on each mutation.
 */
useDemoStore.subscribe(persistChangedSlices);

// Kick off the read immediately: `whenDemoStoreHydrated()` is only meaningful
// if the read is already in flight by the time anyone awaits it.
beginDemoHydration();

/* ------------------------------------------------------------------ */
/*  Collection totals                                                   */
/* ------------------------------------------------------------------ */

export interface DemoCollectionTotals {
  /** Sum of every copy across every binder. */
  totalCards: number;
  /** Distinct card ids, however many copies of each are owned. */
  uniqueCards: number;
  /** Sum of price × quantity, rounded to cents. */
  totalValue: number;
}

function collectionTotals(binders: DemoBinder[]): DemoCollectionTotals {
  const unique = new Set<string>();
  let totalCards = 0;
  let totalValue = 0;
  for (const binder of binders) {
    for (const card of binder.cards) {
      const quantity = Math.max(card.quantity ?? 0, 0);
      unique.add(card.cardId);
      totalCards += quantity;
      totalValue += (card.price ?? 0) * quantity;
    }
  }
  return {
    totalCards,
    uniqueCards: unique.size,
    totalValue: Math.round(totalValue * 100) / 100,
  };
}

let seedTotals: DemoCollectionTotals | null = null;

/** Totals for the untouched seed collection — computed once, never changes. */
function seedCollectionTotals(): DemoCollectionTotals {
  if (!seedTotals) seedTotals = collectionTotals(seedBinders());
  return seedTotals;
}

/**
 * Aggregate totals for the demo collection.
 *
 * Safe to call from a client component during render: it reads the live store
 * once the demo has been initialised, and otherwise reports the fixed-seed
 * starting collection without mutating the store.
 */
export function getDemoCollectionTotals(): DemoCollectionTotals {
  const { initialized, binders } = useDemoStore.getState();
  return initialized ? collectionTotals(binders) : seedCollectionTotals();
}

/**
 * Reactive variant of {@link getDemoCollectionTotals} — re-renders the caller
 * whenever the demo collection changes.
 */
export function useDemoCollectionTotals(): DemoCollectionTotals {
  return useDemoStore(
    useShallow((state) =>
      state.initialized
        ? collectionTotals(state.binders)
        : seedCollectionTotals(),
    ),
  );
}

/* ------------------------------------------------------------------ */
/*  Collection breakdowns                                               */
/* ------------------------------------------------------------------ */

export interface DemoGameBreakdownEntry {
  tcg: TcgCode;
  game: string;
  color: string;
  cards: number;
  value: number;
}

export interface DemoRarityBreakdownEntry {
  rarity: string;
  count: number;
  pct: number;
}

/**
 * Binder cards carry the app-wide TcgCode, not just the three games the demo
 * seeds — the sandbox lets a visitor add cards from any supported game — so
 * the breakdown covers all of them and reuses the shared label map.
 */
const GAME_ORDER: TcgCode[] = [
  "yugioh",
  "magic",
  "pokemon",
  "onepiece",
  "lorcana",
  "dragonball",
];

const GAME_COLORS: Record<TcgCode, string> = {
  yugioh: "#ef4444",
  magic: "#8b5cf6",
  pokemon: "#f59e0b",
  onepiece: "#0ea5e9",
  lorcana: "#14b8a6",
  dragonball: "#f97316",
};

/**
 * Rarity tiers, in display order. Each demo rarity string maps to exactly one
 * bucket so the counts always sum back to the collection total; anything
 * unrecognised falls into the "Rare" middle tier rather than being dropped.
 */
const RARITY_TIERS: Array<{ label: string; matches: string[] }> = [
  { label: "Common / Uncommon", matches: ["Common", "Uncommon"] },
  { label: "Rare", matches: ["Rare", "Super Rare", "Double Rare"] },
  {
    label: "Ultra / Secret Rare",
    matches: [
      "Ultra Rare",
      "Secret Rare",
      "Prismatic Secret Rare",
      "VMAX",
      "VSTAR",
      "Alt Art VMAX",
    ],
  },
  {
    label: "Mythic / Special Art",
    matches: ["Mythic Rare", "Special Art Rare", "Shining"],
  },
];

function rarityTier(rarity: string): string {
  for (const tier of RARITY_TIERS) {
    if (tier.matches.includes(rarity)) return tier.label;
  }
  return "Rare";
}

function gameBreakdown(binders: DemoBinder[]): DemoGameBreakdownEntry[] {
  const acc = new Map<TcgCode, { cards: number; value: number }>();
  for (const binder of binders) {
    for (const card of binder.cards) {
      const quantity = Math.max(card.quantity ?? 0, 0);
      const entry = acc.get(card.tcg) ?? { cards: 0, value: 0 };
      entry.cards += quantity;
      entry.value += (card.price ?? 0) * quantity;
      acc.set(card.tcg, entry);
    }
  }
  return GAME_ORDER.map((tcg) => ({
    tcg,
    game: GAME_LABELS[tcg],
    color: GAME_COLORS[tcg],
    cards: acc.get(tcg)?.cards ?? 0,
    value: Math.round((acc.get(tcg)?.value ?? 0) * 100) / 100,
  })).filter((entry) => entry.cards > 0);
}

function rarityBreakdown(binders: DemoBinder[]): DemoRarityBreakdownEntry[] {
  const acc = new Map<string, number>();
  let total = 0;
  for (const binder of binders) {
    for (const card of binder.cards) {
      const quantity = Math.max(card.quantity ?? 0, 0);
      const tier = rarityTier(card.rarity);
      acc.set(tier, (acc.get(tier) ?? 0) + quantity);
      total += quantity;
    }
  }
  return RARITY_TIERS.map((tier) => {
    const count = acc.get(tier.label) ?? 0;
    return {
      rarity: tier.label,
      count,
      pct: total ? Math.round((count / total) * 100) : 0,
    };
  }).filter((entry) => entry.count > 0);
}

/**
 * These selectors return arrays of freshly built objects, which `useShallow`
 * compares element-by-element by reference — so an uncached selector would
 * never compare equal and would re-render on every store read. Memoising on
 * the `binders` array identity keeps the snapshot stable between changes.
 */
const gameBreakdownCache = new WeakMap<
  DemoBinder[],
  DemoGameBreakdownEntry[]
>();
const rarityBreakdownCache = new WeakMap<
  DemoBinder[],
  DemoRarityBreakdownEntry[]
>();

/** The pristine seed binders, allocated once so the caches can key off them. */
let seedBindersCache: DemoBinder[] | null = null;
function cachedSeedBinders(): DemoBinder[] {
  if (!seedBindersCache) seedBindersCache = seedBinders();
  return seedBindersCache;
}

function memoized<T>(
  cache: WeakMap<DemoBinder[], T>,
  binders: DemoBinder[],
  compute: (binders: DemoBinder[]) => T,
): T {
  const hit = cache.get(binders);
  if (hit) return hit;
  const value = compute(binders);
  cache.set(binders, value);
  return value;
}

/** Per-game copy counts and value for the demo collection. */
export function useDemoGameBreakdown(): DemoGameBreakdownEntry[] {
  return useDemoStore(
    useShallow((state) =>
      memoized(
        gameBreakdownCache,
        state.initialized ? state.binders : cachedSeedBinders(),
        gameBreakdown,
      ),
    ),
  );
}

/** Copy counts per rarity tier for the demo collection. */
export function useDemoRarityBreakdown(): DemoRarityBreakdownEntry[] {
  return useDemoStore(
    useShallow((state) =>
      memoized(
        rarityBreakdownCache,
        state.initialized ? state.binders : cachedSeedBinders(),
        rarityBreakdown,
      ),
    ),
  );
}
