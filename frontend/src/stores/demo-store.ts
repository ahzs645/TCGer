import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEMO_CARDS, type DemoCard, type DemoTcg } from '@/lib/data/demo-cards';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface DemoBinderCard {
  id: string;
  cardId: string; // references DemoCard.id
  name: string;
  tcg: DemoTcg;
  setCode: string;
  setName: string;
  rarity: string;
  condition: string;
  price: number;
  quantity: number;
  addedAt: string;
}

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
  tcg: DemoTcg;
  setCode: string;
  setName: string;
  rarity: string;
  addedAt: string;
}

export interface DemoWishlist {
  id: string;
  name: string;
  description: string;
  color: string;
  cards: DemoWishlistCard[];
  createdAt: string;
}

export interface DemoProfile {
  username: string;
  email: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

let _idCounter = Date.now();
function uid(): string {
  return `demo-${(++_idCounter).toString(36)}`;
}

const CONDITIONS = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played'];
function randomCondition(): string {
  return CONDITIONS[Math.floor(Math.random() * CONDITIONS.length)];
}

const BINDER_COLORS = ['#3b82f6', '#8b5cf6', '#ef4444', '#f59e0b', '#10b981', '#6366f1', '#ec4899', '#14b8a6'];

/* ------------------------------------------------------------------ */
/*  Seed data                                                           */
/* ------------------------------------------------------------------ */

function seedBinders(): DemoBinder[] {
  const now = new Date().toISOString();

  const makeCard = (card: DemoCard, qty = 1): DemoBinderCard => ({
    id: uid(),
    cardId: card.id,
    name: card.name,
    tcg: card.tcg,
    setCode: card.setCode,
    setName: card.setName,
    rarity: card.rarity,
    condition: randomCondition(),
    price: card.price,
    quantity: qty,
    addedAt: now
  });

  const ygoCards = DEMO_CARDS.filter((c) => c.tcg === 'yugioh');
  const mtgCards = DEMO_CARDS.filter((c) => c.tcg === 'magic');
  const pkmCards = DEMO_CARDS.filter((c) => c.tcg === 'pokemon');

  return [
    {
      id: uid(),
      name: 'Main Deck',
      color: '#3b82f6',
      cards: ygoCards.slice(0, 6).map((c) => makeCard(c, Math.ceil(Math.random() * 3))),
      createdAt: now,
      updatedAt: now
    },
    {
      id: uid(),
      name: 'Modern Staples',
      color: '#8b5cf6',
      cards: mtgCards.slice(0, 8).map((c) => makeCard(c, Math.ceil(Math.random() * 4))),
      createdAt: now,
      updatedAt: now
    },
    {
      id: uid(),
      name: 'Scarlet & Violet',
      color: '#ef4444',
      cards: pkmCards.slice(0, 5).map((c) => makeCard(c, Math.ceil(Math.random() * 2))),
      createdAt: now,
      updatedAt: now
    },
    {
      id: uid(),
      name: 'Staples',
      color: '#f59e0b',
      cards: ygoCards.slice(6, 12).map((c) => makeCard(c, Math.ceil(Math.random() * 3))),
      createdAt: now,
      updatedAt: now
    },
    {
      id: uid(),
      name: 'Vintage Box',
      color: '#10b981',
      cards: pkmCards.slice(5, 10).map((c) => makeCard(c, 1)),
      createdAt: now,
      updatedAt: now
    },
    {
      id: uid(),
      name: 'Commander',
      color: '#6366f1',
      cards: mtgCards.slice(8, 15).map((c) => makeCard(c, Math.ceil(Math.random() * 2))),
      createdAt: now,
      updatedAt: now
    }
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
    addedAt: now
  });

  return [
    {
      id: uid(),
      name: 'Must-Have Staples',
      description: 'Key staples across all games',
      color: '#f59e0b',
      cards: [
        makeWCard(DEMO_CARDS[6]),  // Ash Blossom
        makeWCard(DEMO_CARDS[20]), // Lightning Bolt
        makeWCard(DEMO_CARDS[41]), // Pikachu VMAX
        makeWCard(DEMO_CARDS[7]),  // Nibiru
        makeWCard(DEMO_CARDS[21]), // Counterspell
        makeWCard(DEMO_CARDS[11]), // Pot of Prosperity
        makeWCard(DEMO_CARDS[42]), // Mew ex
        makeWCard(DEMO_CARDS[8]),  // Infinite Impermanence
        makeWCard(DEMO_CARDS[22]), // Swords to Plowshares
        makeWCard(DEMO_CARDS[10]), // Effect Veiler
        makeWCard(DEMO_CARDS[50]), // Boss's Orders
        makeWCard(DEMO_CARDS[9])   // Called by the Grave
      ],
      createdAt: now
    },
    {
      id: uid(),
      name: 'Scarlet & Violet Chase Cards',
      description: 'Chase cards from Scarlet & Violet era',
      color: '#ef4444',
      cards: [
        makeWCard(DEMO_CARDS[40]), // Charizard ex
        makeWCard(DEMO_CARDS[46]), // Miraidon ex
        makeWCard(DEMO_CARDS[47]), // Koraidon ex
        makeWCard(DEMO_CARDS[44]), // Iono
        makeWCard(DEMO_CARDS[45]), // Gardevoir ex
        makeWCard(DEMO_CARDS[49]), // Arcanine ex
        makeWCard(DEMO_CARDS[42]), // Mew ex
        makeWCard(DEMO_CARDS[48])  // Umbreon ex
      ],
      createdAt: now
    },
    {
      id: uid(),
      name: 'Modern Upgrades',
      description: 'Cards to upgrade Modern deck',
      color: '#8b5cf6',
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
        makeWCard(DEMO_CARDS[38])  // Chalice of the Void
      ],
      createdAt: now
    }
  ];
}

/* ------------------------------------------------------------------ */
/*  Store interface                                                     */
/* ------------------------------------------------------------------ */

interface DemoState {
  initialized: boolean;
  profile: DemoProfile;
  binders: DemoBinder[];
  wishlists: DemoWishlist[];

  // Lifecycle
  init: () => void;
  resetDemo: () => void;

  // Profile
  updateProfile: (data: Partial<DemoProfile>) => void;

  // Binders
  addBinder: (name: string, color?: string) => string;
  removeBinder: (id: string) => void;
  renameBinder: (id: string, name: string) => void;
  addCardToBinder: (binderId: string, card: DemoCard, quantity?: number) => void;
  removeCardFromBinder: (binderId: string, cardInstanceId: string) => void;

  // Wishlists
  addWishlist: (name: string, description?: string) => string;
  removeWishlist: (id: string) => void;
  addCardToWishlist: (wishlistId: string, card: DemoCard) => void;
  removeCardFromWishlist: (wishlistId: string, cardInstanceId: string) => void;

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
      profile: { username: 'Demo User', email: 'demo@tcger.app' },
      binders: [],
      wishlists: [],

      init: () => {
        if (get().initialized) return;
        set({
          initialized: true,
          binders: seedBinders(),
          wishlists: seedWishlists()
        });
      },

      resetDemo: () => {
        set({
          initialized: true,
          profile: { username: 'Demo User', email: 'demo@tcger.app' },
          binders: seedBinders(),
          wishlists: seedWishlists()
        });
      },

      updateProfile: (data) => {
        set((state) => ({
          profile: { ...state.profile, ...data }
        }));
      },

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
              color: color ?? BINDER_COLORS[state.binders.length % BINDER_COLORS.length],
              cards: [],
              createdAt: now,
              updatedAt: now
            }
          ]
        }));
        return id;
      },

      removeBinder: (id) => {
        set((state) => ({
          binders: state.binders.filter((b) => b.id !== id)
        }));
      },

      renameBinder: (id, name) => {
        set((state) => ({
          binders: state.binders.map((b) =>
            b.id === id ? { ...b, name, updatedAt: new Date().toISOString() } : b
          )
        }));
      },

      addCardToBinder: (binderId, card, quantity = 1) => {
        const now = new Date().toISOString();
        set((state) => ({
          binders: state.binders.map((b) => {
            if (b.id !== binderId) return b;
            // If card already exists in binder, increment quantity
            const existing = b.cards.find((c) => c.cardId === card.id);
            if (existing) {
              return {
                ...b,
                updatedAt: now,
                cards: b.cards.map((c) =>
                  c.cardId === card.id ? { ...c, quantity: c.quantity + quantity } : c
                )
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
                  condition: 'Near Mint',
                  price: card.price,
                  quantity,
                  addedAt: now
                }
              ]
            };
          })
        }));
      },

      removeCardFromBinder: (binderId, cardInstanceId) => {
        set((state) => ({
          binders: state.binders.map((b) => {
            if (b.id !== binderId) return b;
            return {
              ...b,
              updatedAt: new Date().toISOString(),
              cards: b.cards.filter((c) => c.id !== cardInstanceId)
            };
          })
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
              description: description ?? '',
              color: BINDER_COLORS[state.wishlists.length % BINDER_COLORS.length],
              cards: [],
              createdAt: new Date().toISOString()
            }
          ]
        }));
        return id;
      },

      removeWishlist: (id) => {
        set((state) => ({
          wishlists: state.wishlists.filter((w) => w.id !== id)
        }));
      },

      addCardToWishlist: (wishlistId, card) => {
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
                  addedAt: new Date().toISOString()
                }
              ]
            };
          })
        }));
      },

      removeCardFromWishlist: (wishlistId, cardInstanceId) => {
        set((state) => ({
          wishlists: state.wishlists.map((w) => {
            if (w.id !== wishlistId) return w;
            return {
              ...w,
              cards: w.cards.filter((c) => c.id !== cardInstanceId)
            };
          })
        }));
      },

      // ── Queries ──────────────────────────────────────────────────
      isCardInCollection: (cardId) => {
        return get().binders.some((b) =>
          b.cards.some((c) => c.cardId === cardId)
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
      }
    }),
    {
      name: 'tcg-demo-store'
    }
  )
);
