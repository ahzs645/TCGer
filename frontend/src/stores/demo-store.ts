import { create } from "zustand";
import { persist } from "zustand/middleware";
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

export const useDemoStore = create<DemoState>()(
  persist(
    (set, get) => ({
      initialized: false,
      profile: { username: "Demo User", email: "demo@tcger.app" },
      preferences: DEFAULT_DEMO_PREFERENCES,
      binders: [],
      wishlists: [],
      decks: DEMO_DECKS,
      trades: DEMO_TRADES,
      sealed: DEMO_SEALED_PRODUCTS,

      init: () => {
        if (get().initialized) return;
        set({
          initialized: true,
          binders: seedBinders(),
          wishlists: seedWishlists(),
          decks: DEMO_DECKS,
          trades: DEMO_TRADES,
          sealed: DEMO_SEALED_PRODUCTS,
        });
      },

      resetDemo: () => {
        set({
          initialized: true,
          profile: { username: "Demo User", email: "demo@tcger.app" },
          preferences: DEFAULT_DEMO_PREFERENCES,
          binders: seedBinders(),
          wishlists: seedWishlists(),
          decks: DEMO_DECKS,
          trades: DEMO_TRADES,
          sealed: DEMO_SEALED_PRODUCTS,
        });
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
    }),
    {
      name: "tcg-demo-store",
    },
  ),
);

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
