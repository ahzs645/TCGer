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
import type {
  AddWishlistCardInput,
  Card,
  CardDataPayload,
  CollectionCardCopy,
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
const EMPTY_WISHLISTS: DemoWishlist[] = [];

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
  setCompletionMode: 'standard',
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

function needsCatalogImage(
  card: DemoBinderCard | DemoWishlistCard,
): boolean {
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

/** Loose shape check — a stored payload predates any version field. */
function isPlausibleSlice(slice: DemoSlice, value: unknown): boolean {
  switch (slice) {
    case "binders":
    case "wishlists":
    case "decks":
    case "trades":
    case "sealed":
      return Array.isArray(value);
    case "profile":
    case "preferences":
      return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return (
    createLocalStoragePersistence() ?? {
      // No storage at all (SSR, prerender, a browser with it disabled). The
      // memory fallback is synchronous by construction, so mark it as such.
      ...createMemoryPersistence(),
      hydratesSynchronously: true,
    }
  );
}

/** The persisted slices as they are before anything is stored or seeded. */
function initialPersistedState(): PersistedDemoState {
  return {
    initialized: false,
    profile: DEFAULT_DEMO_PROFILE,
    preferences: DEFAULT_DEMO_PREFERENCES,
    binders: EMPTY_BINDERS,
    wishlists: EMPTY_WISHLISTS,
    decks: DEMO_DECKS,
    trades: DEMO_TRADES,
    sealed: DEMO_SEALED_PRODUCTS,
  };
}

let persistence: MaybeSyncPersistence = createDefaultDemoPersistence();

/**
 * What is believed to be on disk, by reference. A slice is committed only when
 * the store's value stops being the value we last wrote (or last read), which
 * is also what keeps `decks`/`trades`/`sealed` out of storage: `init()` and
 * `resetDemo()` assign the very `DEMO_DECKS` / `DEMO_TRADES` /
 * `DEMO_SEALED_PRODUCTS` arrays this baseline starts with, so they only ever
 * differ once an action has built a new array from them.
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
      const stored = snapshot[slice];
      if (stored === undefined || stored === current[slice]) continue;
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
      (snapshot.binders !== undefined || snapshot.wishlists !== undefined)
    ) {
      patch.initialized = true;
      changed = true;
    }
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
  applyToStore(initialPersistedState());
  beginDemoHydration();
}

/** Seed the fixtures, but only if this visitor genuinely has nothing. */
function seedDemoIfEmpty(): void {
  if (useDemoStore.getState().initialized) return;
  useDemoStore.setState({
    initialized: true,
    binders: seedBinders(),
    wishlists: seedWishlists(),
    decks: DEMO_DECKS,
    trades: DEMO_TRADES,
    sealed: DEMO_SEALED_PRODUCTS,
  });
}

function resetDemoState(): void {
  // Apply in memory first so the UI turns over in the same tick, with commits
  // suppressed: `DemoPersistence` orders `commit()` against nothing, so a
  // commit issued now could land either side of the `clear()` below. Once the
  // clear has resolved the baseline is reset and the fresh state is committed
  // from scratch — decks/trades/sealed excluded, since they are seeds again.
  applyToStore({
    initialized: true,
    profile: DEFAULT_DEMO_PROFILE,
    preferences: DEFAULT_DEMO_PREFERENCES,
    binders: seedBinders(),
    wishlists: seedWishlists(),
    decks: DEMO_DECKS,
    trades: DEMO_TRADES,
    sealed: DEMO_SEALED_PRODUCTS,
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
  binders: DemoBinder[];
  wishlists: DemoWishlist[];
  decks: Deck[];
  trades: Trade[];
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
  }) => string;
  removeDeck: (id: string) => void;
  addTrade: (input: {
    partner: string;
    giving: Trade["giving"];
    receiving: Trade["receiving"];
  }) => string;
  setTradeStatus: (id: string, status: Trade["status"]) => void;
  addSealedProduct: (input: {
    name: string;
    tcg: SealedProduct["tcg"];
    type: string;
    set: string;
    quantity: number;
    purchasePrice: number;
    currentValue: number;
  }) => string;
  removeSealedProduct: (id: string) => void;

  // Binders
  addBinder: (name: string, color?: string) => string;
  removeBinder: (id: string) => void;
  renameBinder: (id: string, name: string) => void;
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
  ) => DemoBinderCard | null;
  removeCardFromBinder: (binderId: string, cardInstanceId: string) => void;

  // Wishlists
  addWishlist: (name: string, description?: string) => string;
  removeWishlist: (id: string) => void;
  addCardToWishlist: (
    wishlistId: string,
    card: DemoOwnedCard,
    cardData?: AddWishlistCardInput,
  ) => void;
  removeCardFromWishlist: (wishlistId: string, cardInstanceId: string) => void;
  addWishlistRule: (
    wishlistId: string,
    rule: Omit<DemoWishlistRule, "id" | "createdAt" | "updatedAt">,
  ) => DemoWishlistRule | null;
  updateWishlistRule: (
    wishlistId: string,
    ruleId: string,
    patch: Partial<
      Pick<
        DemoWishlistRule,
        "autoSync" | "includeAllPrintings" | "lastSyncedAt" | "lastMatchCount"
      >
    >,
  ) => DemoWishlistRule | null;
  removeWishlistRule: (wishlistId: string, ruleId: string) => void;

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
  binders: EMPTY_BINDERS,
  wishlists: EMPTY_WISHLISTS,
  decks: DEMO_DECKS,
  trades: DEMO_TRADES,
  sealed: DEMO_SEALED_PRODUCTS,

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

    set((state) => ({
      binders: state.binders.map((binder) => ({
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
      })),
      wishlists: state.wishlists.map((wishlist) => ({
        ...wishlist,
        cards: wishlist.cards.map((card) => {
          const match = matches.get(`wishlist:${card.id}`);
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
      })),
    }));
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

  // ── Binders ──────────────────────────────────────────────────
  /* ---------- Decks, trades and sealed inventory ---------- */

  addDeck: ({ name, tcg, format, description }) => {
    const id = uid();
    set((state) => ({
      decks: [
        {
          id,
          name,
          tcg,
          format,
          description: description?.trim() || "No description yet.",
          color: DECK_COLORS[state.decks.length % DECK_COLORS.length],
          cards: [],
          lastUpdated: new Date().toISOString().slice(0, 10),
          isComplete: false,
        },
        ...state.decks,
      ],
    }));
    return id;
  },

  removeDeck: (id) =>
    set((state) => ({ decks: state.decks.filter((d) => d.id !== id) })),

  addTrade: ({ partner, giving, receiving }) => {
    const id = uid();
    set((state) => ({
      trades: [
        {
          id,
          partner,
          status: "pending",
          date: new Date().toISOString().slice(0, 10),
          giving,
          receiving,
        },
        ...state.trades,
      ],
    }));
    return id;
  },

  setTradeStatus: (id, status) =>
    set((state) => ({
      trades: state.trades.map((t) => (t.id === id ? { ...t, status } : t)),
    })),

  addSealedProduct: ({
    name,
    tcg,
    type,
    set: setName,
    quantity,
    purchasePrice,
    currentValue,
  }) => {
    const id = uid();
    set((state) => ({
      sealed: [
        {
          id,
          name,
          tcg,
          type,
          quantity,
          purchasePrice,
          currentValue,
          purchaseDate: new Date().toISOString().slice(0, 10),
          set: setName,
        },
        ...state.sealed,
      ],
    }));
    return id;
  },

  removeSealedProduct: (id) =>
    set((state) => ({ sealed: state.sealed.filter((p) => p.id !== id) })),

  addBinder: (name, color) => {
    const id = uid();
    const now = new Date().toISOString();
    set((state) => ({
      binders: [
        ...state.binders,
        {
          id,
          name,
          color:
            color ??
            BINDER_COLORS[state.binders.length % BINDER_COLORS.length],
          cards: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
    }));
    return id;
  },

  removeBinder: (id) => {
    set((state) => ({
      binders: state.binders.filter((b) => b.id !== id),
    }));
  },

  renameBinder: (id, name) => {
    set((state) => ({
      binders: state.binders.map((b) =>
        b.id === id
          ? { ...b, name, updatedAt: new Date().toISOString() }
          : b,
      ),
    }));
  },

  addCardToBinder: (binderId, card, quantity = 1, details) => {
    const now = new Date().toISOString();
    const copyInput: DemoCopyInput = {
      condition: details?.copy?.condition ?? "Near Mint",
      language: details?.copy?.language,
      notes: details?.copy?.notes,
      price: details?.copy?.price ?? card.price,
      acquisitionPrice: details?.copy?.acquisitionPrice,
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
    };
    const newCopies = Array.from({ length: quantity }, () =>
      makeDemoCopy(copyInput),
    );
    set((state) => ({
      binders: state.binders.map((b) => {
        if (b.id !== binderId) return b;
        const existing = b.cards.find((c) => c.cardId === card.id);
        if (existing) {
          const existingCopies =
            existing.copies ??
            Array.from({ length: existing.quantity }, () =>
              makeDemoCopy({
                condition: existing.condition,
                price: existing.price,
              }),
            );
          return {
            ...b,
            updatedAt: now,
            cards: b.cards.map((c) =>
              c.cardId === card.id
                ? {
                    ...c,
                    quantity: existingCopies.length + newCopies.length,
                    cardData: details?.cardData ?? c.cardData,
                    copies: [...existingCopies, ...newCopies],
                  }
                : c,
            ),
          };
        }
        return {
          ...b,
          updatedAt: now,
          cards: [
            ...b.cards,
            {
              id: uid(),
              cardId: card.id,
              name: card.name,
              tcg: card.tcg,
              setCode: card.setCode,
              setName: card.setName,
              rarity: card.rarity,
              condition: "Near Mint",
              price: card.price,
              quantity,
              addedAt: now,
              cardData: details?.cardData,
              copies: newCopies,
            },
          ],
        };
      }),
    }));
  },

  updateCardInBinder: (binderId, cardOrCopyId, updates) => {
    let updatedResult: DemoBinderCard | null = null;
    set((state) => ({
      binders: state.binders.map((binder) => {
        if (binder.id !== binderId) return binder;
        const cardIndex = binder.cards.findIndex(
          (card) =>
            card.id === cardOrCopyId ||
            card.copies?.some((copy) => copy.id === cardOrCopyId),
        );
        if (cardIndex < 0) return binder;

        const current = binder.cards[cardIndex];
        const fallbackCopies =
          current.copies ??
          Array.from({ length: current.quantity }, () =>
            makeDemoCopy({
              condition: current.condition,
              price: current.price,
            }),
          );
        const targetsWholeCard = current.id === cardOrCopyId;
        const copyUpdates = fallbackCopies.map((copy) => {
          if (!targetsWholeCard && copy.id !== cardOrCopyId) return copy;
          return {
            ...copy,
            condition:
              updates.condition === undefined
                ? copy.condition
                : (updates.condition ?? undefined),
            language:
              updates.language === undefined
                ? copy.language
                : (updates.language ?? undefined),
            notes:
              updates.notes === undefined
                ? copy.notes
                : (updates.notes ?? undefined),
            isFoil: updates.isFoil ?? copy.isFoil,
            finishCode:
              updates.finishCode === undefined
                ? copy.finishCode
                : (updates.finishCode ?? undefined),
            finishLabel:
              updates.finishLabel === undefined
                ? copy.finishLabel
                : (updates.finishLabel ?? undefined),
            edition:
              updates.edition === undefined
                ? copy.edition
                : (updates.edition ?? undefined),
            stamp:
              updates.stamp === undefined
                ? copy.stamp
                : (updates.stamp ?? undefined),
            isSealedPromo:
              updates.isSealedPromo ?? copy.isSealedPromo,
            isOversized: updates.isOversized ?? copy.isOversized,
            isPeelOff: updates.isPeelOff ?? copy.isPeelOff,
            isSigned: updates.isSigned ?? copy.isSigned,
            isAltered: updates.isAltered ?? copy.isAltered,
            gradingCompany:
              updates.gradingCompany === undefined
                ? copy.gradingCompany
                : (updates.gradingCompany ?? undefined),
            gradingScore:
              updates.gradingScore === undefined
                ? copy.gradingScore
                : (updates.gradingScore ?? undefined),
            certNumber:
              updates.certNumber === undefined
                ? copy.certNumber
                : (updates.certNumber ?? undefined),
            storageLocation:
              updates.storageLocation === undefined
                ? copy.storageLocation
                : (updates.storageLocation ?? undefined),
          };
        });

        let copies = copyUpdates;
        if (updates.quantity !== undefined && targetsWholeCard) {
          const desired = Math.max(1, updates.quantity);
          if (desired < copies.length) {
            copies = copies.slice(0, desired);
          } else {
            const template = copies[0] ?? makeDemoCopy();
            while (copies.length < desired) {
              copies = [
                ...copies,
                { ...template, id: uid(), serialNumber: undefined },
              ];
            }
          }
        }

        const override = updates.cardOverride;
        const cardData = override?.cardData ?? current.cardData;
        const next: DemoBinderCard = {
          ...current,
          cardId: override?.cardId ?? current.cardId,
          name: cardData?.name ?? current.name,
          tcg: (cardData?.tcg as TcgCode | undefined) ?? current.tcg,
          setCode: cardData?.setCode ?? current.setCode,
          setName: cardData?.setName ?? current.setName,
          rarity: cardData?.rarity ?? current.rarity,
          condition: copies[0]?.condition ?? current.condition,
          price: copies[0]?.price ?? current.price,
          quantity: copies.length,
          cardData,
          copies,
        };
        updatedResult = next;
        const cards = [...binder.cards];
        cards[cardIndex] = next;
        return {
          ...binder,
          updatedAt: new Date().toISOString(),
          cards,
        };
      }),
    }));
    return updatedResult;
  },

  removeCardFromBinder: (binderId, cardInstanceId) => {
    set((state) => ({
      binders: state.binders.map((b) => {
        if (b.id !== binderId) return b;
        return {
          ...b,
          updatedAt: new Date().toISOString(),
          cards: b.cards.filter((c) => c.id !== cardInstanceId),
        };
      }),
    }));
  },

  // ── Wishlists ────────────────────────────────────────────────
  addWishlist: (name, description) => {
    const id = uid();
    set((state) => ({
      wishlists: [
        ...state.wishlists,
        {
          id,
          name,
          description: description ?? "",
          color:
            BINDER_COLORS[state.wishlists.length % BINDER_COLORS.length],
          cards: [],
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    return id;
  },

  removeWishlist: (id) => {
    set((state) => ({
      wishlists: state.wishlists.filter((w) => w.id !== id),
    }));
  },

  addCardToWishlist: (wishlistId, card, cardData) => {
    set((state) => ({
      wishlists: state.wishlists.map((w) => {
        if (w.id !== wishlistId) return w;
        if (w.cards.some((c) => c.cardId === card.id)) return w; // already added
        return {
          ...w,
          cards: [
            ...w.cards,
            {
              id: uid(),
              cardId: card.id,
              name: card.name,
              tcg: card.tcg,
              setCode: card.setCode,
              setName: card.setName,
              rarity: card.rarity,
              addedAt: new Date().toISOString(),
              cardData,
            },
          ],
        };
      }),
    }));
  },

  removeCardFromWishlist: (wishlistId, cardInstanceId) => {
    set((state) => ({
      wishlists: state.wishlists.map((w) => {
        if (w.id !== wishlistId) return w;
        return {
          ...w,
          cards: w.cards.filter((c) => c.id !== cardInstanceId),
        };
      }),
    }));
  },

  addWishlistRule: (wishlistId, rule) => {
    const timestamp = new Date().toISOString();
    let saved: DemoWishlistRule | null = null;
    set((state) => ({
      wishlists: state.wishlists.map((w) => {
        if (w.id !== wishlistId) return w;
        const rules = w.rules ?? [];
        // Re-adding the same rule refreshes it rather than duplicating.
        const existing = rules.find(
          (candidate) =>
            candidate.type === rule.type &&
            candidate.tcg === rule.tcg &&
            candidate.query === rule.query &&
            candidate.setCode === rule.setCode,
        );
        if (existing) {
          saved = {
            ...existing,
            ...rule,
            setName: rule.setName ?? existing.setName,
            updatedAt: timestamp,
          };
          const next = saved;
          return {
            ...w,
            rules: rules.map((candidate) =>
              candidate.id === existing.id ? next : candidate,
            ),
          };
        }
        saved = {
          ...rule,
          id: uid(),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        return { ...w, rules: [...rules, saved] };
      }),
    }));
    return saved;
  },

  updateWishlistRule: (wishlistId, ruleId, patch) => {
    const timestamp = new Date().toISOString();
    let saved: DemoWishlistRule | null = null;
    set((state) => ({
      wishlists: state.wishlists.map((w) => {
        if (w.id !== wishlistId) return w;
        return {
          ...w,
          rules: (w.rules ?? []).map((rule) => {
            if (rule.id !== ruleId) return rule;
            saved = { ...rule, ...patch, updatedAt: timestamp };
            return saved;
          }),
        };
      }),
    }));
    return saved;
  },

  removeWishlistRule: (wishlistId, ruleId) => {
    set((state) => ({
      wishlists: state.wishlists.map((w) =>
        w.id === wishlistId
          ? { ...w, rules: (w.rules ?? []).filter((r) => r.id !== ruleId) }
          : w,
      ),
    }));
  },

  // ── Queries ──────────────────────────────────────────────────
  isCardInCollection: (cardId) => {
    return get().binders.some((b) =>
      b.cards.some((c) => c.cardId === cardId),
    );
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
    }))
    .filter((entry) => entry.cards > 0);
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
