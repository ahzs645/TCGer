/**
 * Demo adapter — implements all API function signatures using the demo store
 * (localStorage) as the backend. Each real API module delegates here when
 * isDemoMode() returns true.
 */

import { useDemoStore, type DemoBinder, type DemoBinderCard, type DemoWishlist, type DemoWishlistCard } from '@/stores/demo-store';
import { searchDemoCards, DEMO_CARDS, type DemoCard } from '@/lib/data/demo-cards';
import type { AuthResponse, AuthUser, SetupCheckResponse } from '@tcg/api-types';
import type { Binder, CollectionCard, CollectionCardCopy, CollectionTagResponse } from '@tcg/api-types';
import type { WishlistResponse, WishlistCardResponse } from '@tcg/api-types';
import type { UserProfile, UserPreferences } from '@tcg/api-types';
import type { AppSettings } from '@tcg/api-types';
import type { Card, TcgCode } from '@/types/card';
import type { DashboardStats } from '@/lib/api-client';

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function store() {
  return useDemoStore.getState();
}

/** Strip leading '#' from hex color for the API format */
function stripHash(color: string): string {
  return color.startsWith('#') ? color.slice(1) : color;
}

const DEMO_USER_ID = 'demo-user-001';
const DEMO_TOKEN = 'demo-token-static';

function demoAuthUser(): AuthUser {
  const { profile } = store();
  return {
    id: DEMO_USER_ID,
    email: profile.email,
    username: profile.username,
    isAdmin: true,
    showCardNumbers: true,
    showPricing: true,
    enabledYugioh: true,
    enabledMagic: true,
    enabledPokemon: true
  };
}

/* ------------------------------------------------------------------ */
/*  Auth                                                                */
/* ------------------------------------------------------------------ */

export function demoLogin(): AuthResponse {
  store().init();
  return { user: demoAuthUser(), token: DEMO_TOKEN };
}

export function demoSignup(): AuthResponse {
  return demoLogin();
}

export function demoLogout(): void {
  // no-op — demo mode flag is cleared separately
}

export function demoGetCurrentUser(): { user: AuthUser } {
  return { user: demoAuthUser() };
}

export function demoCheckSetupRequired(): SetupCheckResponse {
  return { setupRequired: false };
}

export function demoSetupAdmin(): AuthResponse {
  return demoLogin();
}

/* ------------------------------------------------------------------ */
/*  Collections / Binders                                               */
/* ------------------------------------------------------------------ */

function toCollectionCard(
  card: DemoBinderCard,
  binderId: string,
  binderName: string,
  binderColor: string
): CollectionCard {
  const copy: CollectionCardCopy = {
    id: card.id,
    condition: card.condition,
    price: card.price,
    tags: []
  };

  return {
    id: card.id,
    cardId: card.cardId,
    name: card.name,
    tcg: card.tcg as TcgCode,
    setCode: card.setCode,
    setName: card.setName,
    rarity: card.rarity,
    quantity: card.quantity,
    condition: card.condition,
    price: card.price,
    binderId,
    binderName,
    binderColorHex: stripHash(binderColor),
    copies: [copy]
  };
}

function toBinder(b: DemoBinder): Binder {
  return {
    id: b.id,
    name: b.name,
    description: '',
    colorHex: stripHash(b.color),
    cards: b.cards.map((c) => toCollectionCard(c, b.id, b.name, b.color)),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt
  };
}

export function demoGetCollections(): Binder[] {
  return store().binders.map(toBinder);
}

export function demoCreateCollection(data: { name: string; description?: string; colorHex?: string }): Binder {
  const id = store().addBinder(data.name, data.colorHex ? `#${data.colorHex}` : undefined);
  const binder = store().binders.find((b: DemoBinder) => b.id === id)!;
  return toBinder(binder);
}

export function demoUpdateCollection(
  collectionId: string,
  data: { name?: string; description?: string; colorHex?: string }
): Binder {
  if (data.name) {
    store().renameBinder(collectionId, data.name);
  }
  const binder = store().binders.find((b: DemoBinder) => b.id === collectionId)!;
  return toBinder(binder);
}

export function demoDeleteCollection(collectionId: string): void {
  store().removeBinder(collectionId);
}

export function demoAddCardToCollection(
  collectionId: string,
  data: { cardId: string; quantity?: number; condition?: string; price?: number; cardData?: { name: string; tcg: string; externalId: string; setCode?: string; setName?: string; rarity?: string } }
): void {
  // Try to find the card in the demo card database
  const demoCard = DEMO_CARDS.find((c) => c.id === data.cardId) || (data.cardData ? {
    id: data.cardData.externalId || data.cardId,
    tcg: data.cardData.tcg as DemoCard['tcg'],
    name: data.cardData.name,
    setCode: data.cardData.setCode || '',
    setName: data.cardData.setName || '',
    rarity: data.cardData.rarity || 'Common',
    price: data.price || 0
  } : null);

  if (!demoCard) return;

  // For library add (no specific binder), add to first binder
  const targetBinder = collectionId === '__library__'
    ? store().binders[0]?.id
    : collectionId;

  if (targetBinder) {
    store().addCardToBinder(targetBinder, demoCard, data.quantity ?? 1);
  }
}

export function demoRemoveCardFromCollection(collectionId: string, cardId: string): void {
  store().removeCardFromBinder(collectionId, cardId);
}

export function demoUpdateCollectionCard(
  binderId: string,
  cardId: string,
  _data: Record<string, unknown>
): CollectionCard {
  // For demo, just return the current card state
  const binder = store().binders.find((b: DemoBinder) => b.id === binderId);
  const card = binder?.cards.find((c: DemoBinderCard) => c.id === cardId);
  if (!binder || !card) throw new Error('Card not found');
  return toCollectionCard(card, binder.id, binder.name, binder.color);
}

export function demoGetTags(): CollectionTagResponse[] {
  return [];
}

export function demoCreateTag(data: { label: string; colorHex?: string }): CollectionTagResponse {
  const now = new Date().toISOString();
  return {
    id: `demo-tag-${Date.now()}`,
    label: data.label,
    colorHex: data.colorHex || 'cccccc',
    createdAt: now,
    updatedAt: now
  };
}

/* ------------------------------------------------------------------ */
/*  Wishlists                                                           */
/* ------------------------------------------------------------------ */

function toWishlistCardResponse(
  card: DemoWishlistCard
): WishlistCardResponse {
  const owned = store().isCardInCollection(card.cardId);
  const ownedQuantity = store().getOwnedQuantity(card.cardId);
  return {
    id: card.id,
    externalId: card.cardId,
    tcg: card.tcg as TcgCode,
    name: card.name,
    setCode: card.setCode,
    setName: card.setName,
    rarity: card.rarity,
    owned,
    ownedQuantity,
    createdAt: card.addedAt
  };
}

function toWishlistResponse(w: DemoWishlist): WishlistResponse {
  const cards = w.cards.map(toWishlistCardResponse);
  const totalCards = cards.length;
  const ownedCards = cards.filter((c) => c.owned).length;
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    colorHex: stripHash(w.color),
    cards,
    totalCards,
    ownedCards,
    completionPercent: totalCards > 0 ? Math.round((ownedCards / totalCards) * 100) : 0,
    createdAt: w.createdAt,
    updatedAt: w.createdAt
  };
}

export function demoGetWishlists(): WishlistResponse[] {
  return store().wishlists.map(toWishlistResponse);
}

export function demoGetWishlist(wishlistId: string): WishlistResponse {
  const w = store().wishlists.find((wl: DemoWishlist) => wl.id === wishlistId);
  if (!w) throw new Error('Wishlist not found');
  return toWishlistResponse(w);
}

export function demoCreateWishlist(data: { name: string; description?: string; colorHex?: string }): WishlistResponse {
  const id = store().addWishlist(data.name, data.description);
  const w = store().wishlists.find((wl: DemoWishlist) => wl.id === id)!;
  return toWishlistResponse(w);
}

export function demoUpdateWishlist(
  wishlistId: string,
  _data: { name?: string; description?: string; colorHex?: string }
): WishlistResponse {
  const w = store().wishlists.find((wl: DemoWishlist) => wl.id === wishlistId);
  if (!w) throw new Error('Wishlist not found');
  return toWishlistResponse(w);
}

export function demoDeleteWishlist(wishlistId: string): void {
  store().removeWishlist(wishlistId);
}

export function demoAddCardToWishlist(
  wishlistId: string,
  data: { externalId: string; tcg: string; name: string; setCode?: string; setName?: string; rarity?: string }
): WishlistCardResponse {
  const demoCard: DemoCard = DEMO_CARDS.find((c) => c.id === data.externalId) || {
    id: data.externalId,
    tcg: data.tcg as DemoCard['tcg'],
    name: data.name,
    setCode: data.setCode || '',
    setName: data.setName || '',
    rarity: data.rarity || 'Common',
    price: 0
  };

  store().addCardToWishlist(wishlistId, demoCard);

  const w = store().wishlists.find((wl: DemoWishlist) => wl.id === wishlistId)!;
  const card = w.cards[w.cards.length - 1];
  return toWishlistCardResponse(card);
}

export function demoRemoveCardFromWishlist(wishlistId: string, cardId: string): void {
  store().removeCardFromWishlist(wishlistId, cardId);
}

/* ------------------------------------------------------------------ */
/*  User                                                                */
/* ------------------------------------------------------------------ */

export function demoGetUserProfile(): UserProfile {
  const { profile } = store();
  return {
    id: DEMO_USER_ID,
    email: profile.email,
    username: profile.username,
    isAdmin: true,
    showCardNumbers: true,
    showPricing: true,
    createdAt: '2024-01-01T00:00:00Z'
  };
}

export function demoUpdateUserProfile(data: { username?: string; email?: string }): Omit<UserProfile, 'createdAt'> {
  store().updateProfile(data);
  const { profile } = store();
  return {
    id: DEMO_USER_ID,
    email: profile.email,
    username: profile.username,
    isAdmin: true,
    showCardNumbers: true,
    showPricing: true
  };
}

export function demoChangePassword(): { success: boolean } {
  return { success: true };
}

/* ------------------------------------------------------------------ */
/*  Preferences                                                         */
/* ------------------------------------------------------------------ */

const DEFAULT_PREFS: UserPreferences = {
  showCardNumbers: true,
  showPricing: true,
  enabledYugioh: true,
  enabledMagic: true,
  enabledPokemon: true
};

export function demoGetUserPreferences(): UserPreferences {
  return { ...DEFAULT_PREFS };
}

export function demoUpdateUserPreferences(data: Partial<UserPreferences>): UserPreferences {
  return { ...DEFAULT_PREFS, ...data };
}

/* ------------------------------------------------------------------ */
/*  Settings                                                            */
/* ------------------------------------------------------------------ */

export function demoGetSettings(): AppSettings {
  return {
    id: 1,
    publicDashboard: true,
    publicCollections: true,
    requireAuth: false,
    appName: 'TCGer Demo',
    updatedAt: new Date().toISOString()
  };
}

export function demoUpdateSettings(data: Partial<AppSettings>): AppSettings {
  return { ...demoGetSettings(), ...data };
}

/* ------------------------------------------------------------------ */
/*  Card Search                                                         */
/* ------------------------------------------------------------------ */

function demoCardToCard(dc: DemoCard): Card {
  return {
    id: dc.id,
    tcg: dc.tcg as TcgCode,
    name: dc.name,
    setCode: dc.setCode,
    setName: dc.setName,
    rarity: dc.rarity,
    attributes: { price: dc.price }
  };
}

export function demoSearchCards(params: { query: string; tcg?: TcgCode | 'all' }): Card[] {
  const results = searchDemoCards(params.query, params.tcg as DemoCard['tcg'] | 'all');
  return results.map(demoCardToCard);
}

export function demoFetchCardPrints(): { type: 'simple'; prints: Card[] } {
  return { type: 'simple', prints: [] };
}

export function demoCalculateDashboardStats(): DashboardStats {
  const { binders } = store();
  const stats: DashboardStats = {
    totalCards: 0,
    totalValue: 0,
    byGame: {
      yugioh: { count: 0, estimatedValue: 0 },
      magic: { count: 0, estimatedValue: 0 },
      pokemon: { count: 0, estimatedValue: 0 }
    },
    recentActivity: []
  };

  const recent: DashboardStats['recentActivity'] = [];

  for (const binder of binders) {
    for (const card of binder.cards) {
      const qty = card.quantity;
      const val = card.price * qty;
      stats.totalCards += qty;
      stats.totalValue += val;
      const tcg = card.tcg as TcgCode;
      if (stats.byGame[tcg]) {
        stats.byGame[tcg].count += qty;
        stats.byGame[tcg].estimatedValue += val;
      }
      if (recent.length < 5) {
        recent.push({
          id: card.id,
          name: card.name,
          tcg,
          timestamp: card.addedAt
        });
      }
    }
  }

  stats.recentActivity = recent;
  return stats;
}
