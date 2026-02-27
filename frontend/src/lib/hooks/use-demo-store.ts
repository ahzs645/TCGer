'use client';

import { useCallback, useSyncExternalStore } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface DemoCard {
  id: string;
  name: string;
  condition: string;
  price: string;
}

export interface DemoBinder {
  id: string;
  name: string;
  color: string;
  game: string;
  cards: DemoCard[];
}

export interface DemoWishlistItem {
  id: string;
  name: string;
  tcg: string;
  price: string;
  acquired: boolean;
}

export interface DemoWishlist {
  id: string;
  name: string;
  items: DemoWishlistItem[];
}

export interface DemoRecentItem {
  id: string;
  name: string;
  tcg: string;
  binderId: string;
  binder: string;
  date: string;
}

export interface DemoState {
  binders: DemoBinder[];
  wishlists: DemoWishlist[];
  recentActivity: DemoRecentItem[];
}

/* ------------------------------------------------------------------ */
/*  Default data                                                        */
/* ------------------------------------------------------------------ */

const DEFAULT_STATE: DemoState = {
  binders: [
    {
      id: 'b1', name: 'Main Deck', color: '#3b82f6', game: 'Yu-Gi-Oh!',
      cards: [
        { id: 'c1', name: 'Blue-Eyes White Dragon', condition: 'NM', price: '$24.99' },
        { id: 'c2', name: 'Dark Magician', condition: 'LP', price: '$12.50' },
        { id: 'c3', name: 'Red-Eyes Black Dragon', condition: 'NM', price: '$8.75' },
        { id: 'c4', name: 'Pot of Greed', condition: 'MP', price: '$3.20' },
        { id: 'c5', name: 'Monster Reborn', condition: 'NM', price: '$5.00' }
      ]
    },
    {
      id: 'b2', name: 'Modern Staples', color: '#8b5cf6', game: 'Magic',
      cards: [
        { id: 'c6', name: 'Lightning Bolt', condition: 'NM', price: '$1.50' },
        { id: 'c7', name: 'Counterspell', condition: 'LP', price: '$2.00' },
        { id: 'c8', name: 'Fatal Push', condition: 'NM', price: '$3.25' }
      ]
    },
    {
      id: 'b3', name: 'Scarlet & Violet', color: '#ef4444', game: 'Pokémon',
      cards: [
        { id: 'c9', name: 'Charizard ex', condition: 'NM', price: '$45.00' },
        { id: 'c10', name: 'Pikachu ex', condition: 'NM', price: '$12.00' }
      ]
    },
    {
      id: 'b4', name: 'Staples', color: '#f59e0b', game: 'Yu-Gi-Oh!',
      cards: [
        { id: 'c11', name: 'Ash Blossom & Joyous Spring', condition: 'NM', price: '$18.00' },
        { id: 'c12', name: 'Nibiru, the Primal Being', condition: 'NM', price: '$4.50' },
        { id: 'c13', name: 'Called by the Grave', condition: 'LP', price: '$2.75' }
      ]
    },
    {
      id: 'b5', name: 'Vintage Box', color: '#10b981', game: 'Pokémon',
      cards: [
        { id: 'c14', name: 'Mewtwo VSTAR', condition: 'NM', price: '$8.00' },
        { id: 'c15', name: 'Mew VMAX', condition: 'NM', price: '$11.50' }
      ]
    },
    {
      id: 'b6', name: 'Commander', color: '#6366f1', game: 'Magic',
      cards: [
        { id: 'c16', name: 'Sol Ring', condition: 'NM', price: '$1.00' },
        { id: 'c17', name: 'Command Tower', condition: 'NM', price: '$0.50' },
        { id: 'c18', name: 'Arcane Signet', condition: 'NM', price: '$0.75' }
      ]
    }
  ],
  wishlists: [
    {
      id: 'w1', name: 'Must-Have Staples',
      items: [
        { id: 'wi1', name: 'Ash Blossom & Joyous Spring', tcg: 'Yu-Gi-Oh!', price: '$18.00', acquired: true },
        { id: 'wi2', name: 'Infinite Impermanence', tcg: 'Yu-Gi-Oh!', price: '$6.50', acquired: true },
        { id: 'wi3', name: 'Lightning Storm', tcg: 'Yu-Gi-Oh!', price: '$15.00', acquired: false },
        { id: 'wi4', name: 'Triple Tactics Talent', tcg: 'Yu-Gi-Oh!', price: '$9.00', acquired: true },
        { id: 'wi5', name: 'Forbidden Droplet', tcg: 'Yu-Gi-Oh!', price: '$22.00', acquired: false },
        { id: 'wi6', name: 'Crossout Designator', tcg: 'Yu-Gi-Oh!', price: '$7.00', acquired: true },
        { id: 'wi7', name: 'Effect Veiler', tcg: 'Yu-Gi-Oh!', price: '$1.50', acquired: true },
        { id: 'wi8', name: 'Ghost Ogre & Snow Rabbit', tcg: 'Yu-Gi-Oh!', price: '$2.00', acquired: true },
        { id: 'wi9', name: 'Nibiru, the Primal Being', tcg: 'Yu-Gi-Oh!', price: '$4.50', acquired: true },
        { id: 'wi10', name: 'Dimensional Shifter', tcg: 'Yu-Gi-Oh!', price: '$12.00', acquired: false },
        { id: 'wi11', name: 'Evenly Matched', tcg: 'Yu-Gi-Oh!', price: '$5.00', acquired: false },
        { id: 'wi12', name: 'Dark Ruler No More', tcg: 'Yu-Gi-Oh!', price: '$3.00', acquired: false }
      ]
    },
    {
      id: 'w2', name: 'Scarlet & Violet Chase Cards',
      items: [
        { id: 'wi13', name: 'Charizard ex SAR', tcg: 'Pokémon', price: '$120.00', acquired: true },
        { id: 'wi14', name: 'Miraidon ex SAR', tcg: 'Pokémon', price: '$45.00', acquired: false },
        { id: 'wi15', name: 'Koraidon ex SAR', tcg: 'Pokémon', price: '$38.00', acquired: true },
        { id: 'wi16', name: 'Gardevoir ex SAR', tcg: 'Pokémon', price: '$55.00', acquired: false },
        { id: 'wi17', name: 'Iono SAR', tcg: 'Pokémon', price: '$85.00', acquired: false },
        { id: 'wi18', name: 'Arven SAR', tcg: 'Pokémon', price: '$30.00', acquired: true },
        { id: 'wi19', name: 'Professor Sada SAR', tcg: 'Pokémon', price: '$25.00', acquired: false },
        { id: 'wi20', name: 'Nemona SAR', tcg: 'Pokémon', price: '$20.00', acquired: false }
      ]
    },
    {
      id: 'w3', name: 'Modern Upgrades',
      items: [
        { id: 'wi21', name: 'Ragavan, Nimble Pilferer', tcg: 'Magic', price: '$52.00', acquired: true },
        { id: 'wi22', name: 'Wrenn and Six', tcg: 'Magic', price: '$38.00', acquired: true },
        { id: 'wi23', name: 'Fury', tcg: 'Magic', price: '$18.00', acquired: true },
        { id: 'wi24', name: 'Solitude', tcg: 'Magic', price: '$15.00', acquired: true },
        { id: 'wi25', name: 'Endurance', tcg: 'Magic', price: '$12.00', acquired: false },
        { id: 'wi26', name: 'Subtlety', tcg: 'Magic', price: '$5.00', acquired: true },
        { id: 'wi27', name: 'Grief', tcg: 'Magic', price: '$8.00', acquired: true },
        { id: 'wi28', name: 'Leyline Binding', tcg: 'Magic', price: '$4.00', acquired: true },
        { id: 'wi29', name: 'Omnath, Locus of Creation', tcg: 'Magic', price: '$10.00', acquired: true },
        { id: 'wi30', name: 'Fable of the Mirror-Breaker', tcg: 'Magic', price: '$7.00', acquired: false },
        { id: 'wi31', name: 'The One Ring', tcg: 'Magic', price: '$65.00', acquired: false },
        { id: 'wi32', name: 'Orcish Bowmasters', tcg: 'Magic', price: '$42.00', acquired: true },
        { id: 'wi33', name: 'Sheoldred, the Apocalypse', tcg: 'Magic', price: '$55.00', acquired: false },
        { id: 'wi34', name: 'Boseiju, Who Endures', tcg: 'Magic', price: '$22.00', acquired: false },
        { id: 'wi35', name: 'Otawara, Soaring City', tcg: 'Magic', price: '$14.00', acquired: false }
      ]
    }
  ],
  recentActivity: [
    { id: 'r1', name: 'Blue-Eyes White Dragon', tcg: 'Yu-Gi-Oh!', binderId: 'b1', binder: 'Main Deck', date: 'Feb 24' },
    { id: 'r2', name: 'Lightning Bolt', tcg: 'Magic: The Gathering', binderId: 'b2', binder: 'Modern Staples', date: 'Feb 23' },
    { id: 'r3', name: 'Charizard ex', tcg: 'Pokémon', binderId: 'b3', binder: 'Scarlet & Violet', date: 'Feb 22' },
    { id: 'r4', name: 'Ash Blossom & Joyous Spring', tcg: 'Yu-Gi-Oh!', binderId: 'b4', binder: 'Staples', date: 'Feb 21' },
    { id: 'r5', name: 'Mewtwo VSTAR', tcg: 'Pokémon', binderId: 'b5', binder: 'Vintage Box', date: 'Feb 20' }
  ]
};

/* ------------------------------------------------------------------ */
/*  Storage helpers                                                     */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'tcger-demo-state';

function loadState(): DemoState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    return JSON.parse(raw) as DemoState;
  } catch {
    return DEFAULT_STATE;
  }
}

function saveState(state: DemoState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota exceeded — silently ignore
  }
}

/* ------------------------------------------------------------------ */
/*  Tiny external store (works with useSyncExternalStore)               */
/* ------------------------------------------------------------------ */

let currentState: DemoState = loadState();
const listeners = new Set<() => void>();

function getSnapshot(): DemoState {
  return currentState;
}

function getServerSnapshot(): DemoState {
  return DEFAULT_STATE;
}

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function setState(updater: (prev: DemoState) => DemoState) {
  currentState = updater(currentState);
  saveState(currentState);
  emit();
}

/* ------------------------------------------------------------------ */
/*  Public hook                                                         */
/* ------------------------------------------------------------------ */

let idCounter = Date.now();
function nextId(prefix: string) {
  return `${prefix}${++idCounter}`;
}

export function useDemoStore() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const addBinder = useCallback((name: string, color: string, game: string) => {
    const id = nextId('b');
    setState((prev) => ({
      ...prev,
      binders: [...prev.binders, { id, name, color, game, cards: [] }]
    }));
    return id;
  }, []);

  const deleteBinder = useCallback((binderId: string) => {
    setState((prev) => ({
      ...prev,
      binders: prev.binders.filter((b) => b.id !== binderId)
    }));
  }, []);

  const toggleWishlistItem = useCallback((wishlistId: string, itemId: string) => {
    setState((prev) => ({
      ...prev,
      wishlists: prev.wishlists.map((wl) =>
        wl.id !== wishlistId
          ? wl
          : {
              ...wl,
              items: wl.items.map((item) =>
                item.id !== itemId ? item : { ...item, acquired: !item.acquired }
              )
            }
      )
    }));
  }, []);

  const addWishlist = useCallback((name: string) => {
    const id = nextId('w');
    setState((prev) => ({
      ...prev,
      wishlists: [...prev.wishlists, { id, name, items: [] }]
    }));
    return id;
  }, []);

  const deleteWishlist = useCallback((wishlistId: string) => {
    setState((prev) => ({
      ...prev,
      wishlists: prev.wishlists.filter((wl) => wl.id !== wishlistId)
    }));
  }, []);

  const resetDemo = useCallback(() => {
    setState(() => DEFAULT_STATE);
  }, []);

  /* Derived stats */
  const totalCards = state.binders.reduce((sum, b) => sum + b.cards.length, 0);

  const gameBreakdown = state.binders.reduce<Record<string, { name: string; copies: number }>>(
    (acc, b) => {
      if (!acc[b.game]) acc[b.game] = { name: b.game, copies: 0 };
      acc[b.game].copies += b.cards.length;
      return acc;
    },
    {}
  );

  const games = Object.values(gameBreakdown).map((g) => ({
    ...g,
    pct: totalCards > 0 ? Math.round((g.copies / totalCards) * 100) : 0
  }));

  return {
    ...state,
    totalCards,
    games,
    addBinder,
    deleteBinder,
    toggleWishlistItem,
    addWishlist,
    deleteWishlist,
    resetDemo
  };
}
