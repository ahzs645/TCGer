import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEMO_CARDS, type DemoCard } from "@/lib/data/demo-cards";
import type {
  AddWishlistCardInput,
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
  type: "name" | "set";
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
function randomCondition(): string {
  return CONDITIONS[Math.floor(Math.random() * CONDITIONS.length)];
}

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
  const now = new Date().toISOString();

  const makeCard = (card: DemoCard, qty = 1): DemoBinderCard => {
    const condition = randomCondition();
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
      addedAt: now,
      copies: Array.from({ length: qty }, () =>
        makeDemoCopy({ condition, price: card.price }),
      ),
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
      cards: ygoCards
        .slice(0, 6)
        .map((c) => makeCard(c, Math.ceil(Math.random() * 3))),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid(),
      name: "Modern Staples",
      color: "#8b5cf6",
      cards: mtgCards
        .slice(0, 8)
        .map((c) => makeCard(c, Math.ceil(Math.random() * 4))),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid(),
      name: "Scarlet & Violet",
      color: "#ef4444",
      cards: pkmCards
        .slice(0, 5)
        .map((c) => makeCard(c, Math.ceil(Math.random() * 2))),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid(),
      name: "Staples",
      color: "#f59e0b",
      cards: ygoCards
        .slice(6, 12)
        .map((c) => makeCard(c, Math.ceil(Math.random() * 3))),
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
      cards: mtgCards
        .slice(8, 15)
        .map((c) => makeCard(c, Math.ceil(Math.random() * 2))),
      createdAt: now,
      updatedAt: now,
    },
  ];
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

/* ------------------------------------------------------------------ */
/*  Store interface                                                     */
/* ------------------------------------------------------------------ */

interface DemoState {
  initialized: boolean;
  profile: DemoProfile;
  preferences: UserPreferences;
  binders: DemoBinder[];
  wishlists: DemoWishlist[];

  // Lifecycle
  init: () => void;
  resetDemo: () => void;

  // Profile
  updateProfile: (data: Partial<DemoProfile>) => void;
  updatePreferences: (data: Partial<UserPreferences>) => UserPreferences;
  getPreferences: () => UserPreferences;

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

      init: () => {
        if (get().initialized) return;
        set({
          initialized: true,
          binders: seedBinders(),
          wishlists: seedWishlists(),
        });
      },

      resetDemo: () => {
        set({
          initialized: true,
          profile: { username: "Demo User", email: "demo@tcger.app" },
          preferences: DEFAULT_DEMO_PREFERENCES,
          binders: seedBinders(),
          wishlists: seedWishlists(),
        });
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
