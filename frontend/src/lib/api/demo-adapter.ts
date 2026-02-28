/**
 * Demo route handler — maps URL path + HTTP method to demo store operations
 * and returns real Response objects, so the API files see no difference.
 */

import { useDemoStore, type DemoBinder, type DemoBinderCard, type DemoWishlist, type DemoWishlistCard } from '@/stores/demo-store';
import { searchDemoCards, DEMO_CARDS, type DemoCard } from '@/lib/data/demo-cards';
import type { TcgCode } from '@/types/card';

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function store() {
  return useDemoStore.getState();
}

function stripHash(color: string): string {
  return color.startsWith('#') ? color.slice(1) : color;
}

function json(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })
  );
}

function noContent(): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 204 }));
}

function notFound(msg = 'Not found'): Promise<Response> {
  return json({ message: msg }, 404);
}

const DEMO_USER_ID = 'demo-user-001';

function demoAuthUser() {
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
/*  Type converters                                                     */
/* ------------------------------------------------------------------ */

function toCollectionCard(card: DemoBinderCard, binderId: string, binderName: string, binderColor: string) {
  return {
    id: card.id,
    cardId: card.cardId,
    name: card.name,
    tcg: card.tcg,
    setCode: card.setCode,
    setName: card.setName,
    rarity: card.rarity,
    quantity: card.quantity,
    condition: card.condition,
    price: card.price,
    binderId,
    binderName,
    binderColorHex: stripHash(binderColor),
    copies: [{ id: card.id, condition: card.condition, price: card.price, tags: [] }]
  };
}

function toBinder(b: DemoBinder) {
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

function toWishlistCard(card: DemoWishlistCard) {
  return {
    id: card.id,
    externalId: card.cardId,
    tcg: card.tcg,
    name: card.name,
    setCode: card.setCode,
    setName: card.setName,
    rarity: card.rarity,
    owned: store().isCardInCollection(card.cardId),
    ownedQuantity: store().getOwnedQuantity(card.cardId),
    createdAt: card.addedAt
  };
}

function toWishlist(w: DemoWishlist) {
  const cards = w.cards.map(toWishlistCard);
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

function demoCardToSearchResult(dc: DemoCard) {
  return {
    id: dc.id,
    tcg: dc.tcg,
    name: dc.name,
    setCode: dc.setCode,
    setName: dc.setName,
    rarity: dc.rarity,
    attributes: { price: dc.price }
  };
}

/* ------------------------------------------------------------------ */
/*  Router                                                              */
/* ------------------------------------------------------------------ */

/**
 * Main entry point — called by the fetch interceptor in demo-mode.ts.
 * Parses the URL path and method and dispatches to the right handler.
 */
export function handleDemoRequest(method: string, path: string, body?: unknown): Promise<Response> {
  // Strip query string for routing, but keep it for parsing params
  const [routePath, queryString] = path.split('?');
  const segments = routePath.replace(/^\//, '').split('/');

  // ── Auth ────────────────────────────────────────────────────────
  if (segments[0] === 'auth') {
    return handleAuth(method, segments.slice(1), body);
  }

  // ── Collections / Binders ───────────────────────────────────────
  if (segments[0] === 'collections') {
    return handleCollections(method, segments.slice(1), body);
  }

  // ── Wishlists ───────────────────────────────────────────────────
  if (segments[0] === 'wishlists') {
    return handleWishlists(method, segments.slice(1), body);
  }

  // ── Users ───────────────────────────────────────────────────────
  if (segments[0] === 'users') {
    return handleUsers(method, segments.slice(1), body);
  }

  // ── Settings ────────────────────────────────────────────────────
  if (segments[0] === 'settings') {
    return handleSettings(method, body);
  }

  // ── Card Search ─────────────────────────────────────────────────
  if (segments[0] === 'cards') {
    return handleCards(method, segments.slice(1), queryString);
  }

  return notFound(`Demo: unknown route ${method} ${path}`);
}

/* ------------------------------------------------------------------ */
/*  Auth handlers                                                       */
/* ------------------------------------------------------------------ */

function handleAuth(method: string, segments: string[], body?: unknown): Promise<Response> {
  const action = segments[0];

  if (action === 'signup' && method === 'POST') {
    store().init();
    return json({ user: demoAuthUser(), token: 'demo-token-static' });
  }

  if (action === 'login' && method === 'POST') {
    store().init();
    return json({ user: demoAuthUser(), token: 'demo-token-static' });
  }

  if (action === 'logout' && method === 'POST') {
    return noContent();
  }

  if (action === 'me' && method === 'GET') {
    return json({ user: demoAuthUser() });
  }

  if (action === 'setup-required' && method === 'GET') {
    return json({ setupRequired: false });
  }

  if (action === 'setup' && method === 'POST') {
    store().init();
    return json({ user: demoAuthUser(), token: 'demo-token-static' });
  }

  return notFound();
}

/* ------------------------------------------------------------------ */
/*  Collections handlers                                                */
/* ------------------------------------------------------------------ */

function handleCollections(method: string, segments: string[], body?: unknown): Promise<Response> {
  // GET /collections
  if (segments.length === 0 && method === 'GET') {
    return json(store().binders.map(toBinder));
  }

  // POST /collections
  if (segments.length === 0 && method === 'POST') {
    const data = body as { name: string; description?: string; colorHex?: string };
    const id = store().addBinder(data.name, data.colorHex ? `#${data.colorHex}` : undefined);
    const binder = store().binders.find((b: DemoBinder) => b.id === id)!;
    return json(toBinder(binder));
  }

  // GET/POST /collections/tags
  if (segments[0] === 'tags') {
    if (method === 'GET') return json([]);
    if (method === 'POST') {
      const data = body as { label: string; colorHex?: string };
      const now = new Date().toISOString();
      return json({ id: `demo-tag-${Date.now()}`, label: data.label, colorHex: data.colorHex || 'cccccc', createdAt: now, updatedAt: now });
    }
    return notFound();
  }

  // POST /collections/cards  (library add)
  if (segments[0] === 'cards' && segments.length === 1 && method === 'POST') {
    return handleAddCard('__library__', body);
  }

  const collectionId = segments[0];

  // PATCH /collections/:id
  if (segments.length === 1 && method === 'PATCH') {
    const data = body as { name?: string; description?: string; colorHex?: string };
    if (data.name) store().renameBinder(collectionId, data.name);
    const binder = store().binders.find((b: DemoBinder) => b.id === collectionId);
    return binder ? json(toBinder(binder)) : notFound('Collection not found');
  }

  // DELETE /collections/:id
  if (segments.length === 1 && method === 'DELETE') {
    store().removeBinder(collectionId);
    return noContent();
  }

  // POST /collections/:id/cards
  if (segments[1] === 'cards' && segments.length === 2 && method === 'POST') {
    return handleAddCard(collectionId, body);
  }

  // PATCH /collections/:id/cards/:cardId
  if (segments[1] === 'cards' && segments.length === 3 && method === 'PATCH') {
    const cardId = segments[2];
    const binder = store().binders.find((b: DemoBinder) => b.id === collectionId);
    const card = binder?.cards.find((c: DemoBinderCard) => c.id === cardId);
    if (!binder || !card) return notFound('Card not found');
    return json(toCollectionCard(card, binder.id, binder.name, binder.color));
  }

  // DELETE /collections/:id/cards/:cardId
  if (segments[1] === 'cards' && segments.length === 3 && method === 'DELETE') {
    const cardId = segments[2];
    store().removeCardFromBinder(collectionId, cardId);
    return noContent();
  }

  return notFound();
}

function handleAddCard(collectionId: string, body: unknown): Promise<Response> {
  const data = body as { cardId: string; quantity?: number; price?: number; cardData?: { name: string; tcg: string; externalId: string; setCode?: string; setName?: string; rarity?: string } };
  const demoCard = DEMO_CARDS.find((c) => c.id === data.cardId) || (data.cardData ? {
    id: data.cardData.externalId || data.cardId,
    tcg: data.cardData.tcg as DemoCard['tcg'],
    name: data.cardData.name,
    setCode: data.cardData.setCode || '',
    setName: data.cardData.setName || '',
    rarity: data.cardData.rarity || 'Common',
    price: data.price || 0
  } : null);

  if (!demoCard) return json({ message: 'Card not found' }, 400);

  const targetBinder = collectionId === '__library__'
    ? store().binders[0]?.id
    : collectionId;

  if (targetBinder) {
    store().addCardToBinder(targetBinder, demoCard, data.quantity ?? 1);
  }

  return json({ success: true });
}

/* ------------------------------------------------------------------ */
/*  Wishlists handlers                                                  */
/* ------------------------------------------------------------------ */

function handleWishlists(method: string, segments: string[], body?: unknown): Promise<Response> {
  // GET /wishlists
  if (segments.length === 0 && method === 'GET') {
    return json(store().wishlists.map(toWishlist));
  }

  // POST /wishlists
  if (segments.length === 0 && method === 'POST') {
    const data = body as { name: string; description?: string; colorHex?: string };
    const id = store().addWishlist(data.name, data.description);
    const w = store().wishlists.find((wl: DemoWishlist) => wl.id === id)!;
    return json(toWishlist(w));
  }

  const wishlistId = segments[0];

  // GET /wishlists/:id
  if (segments.length === 1 && method === 'GET') {
    const w = store().wishlists.find((wl: DemoWishlist) => wl.id === wishlistId);
    return w ? json(toWishlist(w)) : notFound('Wishlist not found');
  }

  // PATCH /wishlists/:id
  if (segments.length === 1 && method === 'PATCH') {
    const w = store().wishlists.find((wl: DemoWishlist) => wl.id === wishlistId);
    return w ? json(toWishlist(w)) : notFound('Wishlist not found');
  }

  // DELETE /wishlists/:id
  if (segments.length === 1 && method === 'DELETE') {
    store().removeWishlist(wishlistId);
    return noContent();
  }

  // POST /wishlists/:id/cards
  if (segments[1] === 'cards' && segments.length === 2 && method === 'POST') {
    const data = body as { externalId: string; tcg: string; name: string; setCode?: string; setName?: string; rarity?: string };
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
    return json(toWishlistCard(card));
  }

  // DELETE /wishlists/:id/cards/:cardId
  if (segments[1] === 'cards' && segments.length === 3 && method === 'DELETE') {
    store().removeCardFromWishlist(wishlistId, segments[2]);
    return noContent();
  }

  return notFound();
}

/* ------------------------------------------------------------------ */
/*  Users handlers                                                      */
/* ------------------------------------------------------------------ */

function handleUsers(method: string, segments: string[], body?: unknown): Promise<Response> {
  // GET /users/me
  if (segments[0] === 'me' && segments.length === 1 && method === 'GET') {
    const { profile } = store();
    return json({
      id: DEMO_USER_ID,
      email: profile.email,
      username: profile.username,
      isAdmin: true,
      showCardNumbers: true,
      showPricing: true,
      createdAt: '2024-01-01T00:00:00Z'
    });
  }

  // PATCH /users/me
  if (segments[0] === 'me' && segments.length === 1 && method === 'PATCH') {
    const data = body as { username?: string; email?: string };
    store().updateProfile(data);
    const { profile } = store();
    return json({
      id: DEMO_USER_ID,
      email: profile.email,
      username: profile.username,
      isAdmin: true,
      showCardNumbers: true,
      showPricing: true
    });
  }

  // POST /users/me/change-password
  if (segments[0] === 'me' && segments[1] === 'change-password' && method === 'POST') {
    return json({ success: true });
  }

  // GET /users/me/preferences
  if (segments[0] === 'me' && segments[1] === 'preferences' && method === 'GET') {
    return json({
      showCardNumbers: true,
      showPricing: true,
      enabledYugioh: true,
      enabledMagic: true,
      enabledPokemon: true
    });
  }

  // PATCH /users/me/preferences
  if (segments[0] === 'me' && segments[1] === 'preferences' && method === 'PATCH') {
    const data = body as Record<string, unknown>;
    return json({
      showCardNumbers: true,
      showPricing: true,
      enabledYugioh: true,
      enabledMagic: true,
      enabledPokemon: true,
      ...data
    });
  }

  return notFound();
}

/* ------------------------------------------------------------------ */
/*  Settings handlers                                                   */
/* ------------------------------------------------------------------ */

function handleSettings(method: string, body?: unknown): Promise<Response> {
  const defaults = {
    id: 1,
    publicDashboard: true,
    publicCollections: true,
    requireAuth: false,
    appName: 'TCGer Demo',
    updatedAt: new Date().toISOString()
  };

  if (method === 'GET') return json(defaults);
  if (method === 'PATCH') return json({ ...defaults, ...(body as Record<string, unknown>) });
  return notFound();
}

/* ------------------------------------------------------------------ */
/*  Cards handlers                                                      */
/* ------------------------------------------------------------------ */

function handleCards(method: string, segments: string[], queryString?: string): Promise<Response> {
  // GET /cards/search?query=...&tcg=...
  if (segments[0] === 'search' && method === 'GET') {
    const params = new URLSearchParams(queryString || '');
    const query = params.get('query') || '';
    const tcg = params.get('tcg') as TcgCode | undefined;
    const results = searchDemoCards(query, tcg || 'all');
    return json({ cards: results.map(demoCardToSearchResult) });
  }

  // GET /cards/:tcg/:cardId/prints
  if (segments.length === 3 && segments[2] === 'prints' && method === 'GET') {
    return json({ type: 'simple', prints: [] });
  }

  return notFound();
}

/* ------------------------------------------------------------------ */
/*  Re-export demoLogin for the demo login page                         */
/* ------------------------------------------------------------------ */

export function demoLogin() {
  store().init();
  return { user: demoAuthUser(), token: 'demo-token-static' };
}
