/**
 * Demo route handler — maps URL path + HTTP method to demo store operations
 * and returns real Response objects, so the API files see no difference.
 */

import {
  useDemoStore,
  type DemoBinder,
  type DemoBinderCard,
  type DemoOwnedCard,
  type DemoWishlist,
  type DemoWishlistCard,
} from "@/stores/demo-store";
import {
  searchDemoCards,
  DEMO_CARDS,
  isSyntheticDemoCardId,
  splitDemoPrintingCode,
  type DemoCard,
  type DemoTcg,
} from "@/lib/data/demo-cards";
import { isCatalogInstalled } from "@/lib/catalog/catalog-client";
import {
  CATALOG_GAMES,
  isCatalogGame,
  type CatalogTcgCode,
} from "@/lib/catalog/use-catalog";
import {
  getCardsInSet as getCatalogCardsInSet,
  getSets as getCatalogSets,
  normalizeCatalogText,
  searchCatalog,
} from "@/lib/catalog/catalog-search";
import type { TcgCode } from "@/types/card";
import type {
  AddCardInput,
  AddWishlistCardInput,
  Card,
  CollectionCardCopy,
  CreateWishlistRuleInput,
  TcgSet,
  UpdateCardInput,
  UpdateWishlistRuleInput,
  UserPreferences,
} from "@tcg/api-types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function store() {
  return useDemoStore.getState();
}

function stripHash(color: string): string {
  return color.startsWith("#") ? color.slice(1) : color;
}

function json(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function noContent(): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 204 }));
}

function notFound(msg = "Not found"): Promise<Response> {
  return json({ message: msg }, 404);
}

const DEMO_USER_ID = "demo-user-001";

function demoAuthUser() {
  const { profile, getPreferences } = store();
  return {
    id: DEMO_USER_ID,
    email: profile.email,
    username: profile.username,
    isAdmin: true,
    ...getPreferences(),
  };
}

/* ------------------------------------------------------------------ */
/*  Type converters                                                     */
/* ------------------------------------------------------------------ */

function toCollectionCard(
  card: DemoBinderCard,
  binderId: string,
  binderName: string,
  binderColor: string,
) {
  const copies: CollectionCardCopy[] = card.copies?.length
    ? card.copies
    : Array.from({ length: Math.max(1, card.quantity) }, (_, index) => ({
        id: `${card.id}-copy-${index + 1}`,
        condition: card.condition,
        price: card.price,
        tags: [],
      }));
  return {
    ...card.cardData,
    id: card.id,
    cardId: card.cardId,
    externalId: card.cardData?.externalId ?? card.cardId,
    name: card.cardData?.name ?? card.name,
    tcg: card.tcg,
    setCode:
      card.cardData?.setCode ??
      (isSyntheticDemoCardId(card.cardId)
        ? splitDemoPrintingCode(card.setCode).setCode
        : card.setCode),
    collectorNumber:
      card.cardData?.collectorNumber ??
      (isSyntheticDemoCardId(card.cardId)
        ? splitDemoPrintingCode(card.setCode).collectorNumber
        : undefined),
    setName: card.cardData?.setName ?? card.setName,
    rarity: card.cardData?.rarity ?? card.rarity,
    languageCode: card.cardData?.language,
    quantity: card.quantity,
    condition: card.condition,
    price: card.price,
    binderId,
    binderName,
    binderColorHex: stripHash(binderColor),
    copies,
  };
}

function toBinder(b: DemoBinder) {
  return {
    id: b.id,
    name: b.name,
    description: "",
    colorHex: stripHash(b.color),
    cards: b.cards.map((c) => toCollectionCard(c, b.id, b.name, b.color)),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function toWishlistCard(card: DemoWishlistCard) {
  return {
    ...card.cardData,
    id: card.id,
    externalId: card.cardData?.externalId ?? card.cardId,
    tcg: card.tcg,
    name: card.cardData?.name ?? card.name,
    setCode:
      card.cardData?.setCode ??
      (isSyntheticDemoCardId(card.cardId)
        ? splitDemoPrintingCode(card.setCode).setCode
        : card.setCode),
    collectorNumber:
      card.cardData?.collectorNumber ??
      (isSyntheticDemoCardId(card.cardId)
        ? splitDemoPrintingCode(card.setCode).collectorNumber
        : undefined),
    setName: card.cardData?.setName ?? card.setName,
    rarity: card.cardData?.rarity ?? card.rarity,
    owned: store().isCardInCollection(card.cardId),
    ownedQuantity: store().getOwnedQuantity(card.cardId),
    createdAt: card.addedAt,
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
    rules: w.rules ?? [],
    totalCards,
    ownedCards,
    completionPercent:
      totalCards > 0 ? Math.round((ownedCards / totalCards) * 100) : 0,
    createdAt: w.createdAt,
    updatedAt: w.createdAt,
  };
}

function demoCardToSearchResult(dc: DemoCard) {
  const { setCode, collectorNumber } = splitDemoPrintingCode(dc.setCode);
  return {
    id: dc.id,
    tcg: dc.tcg,
    name: dc.name,
    setCode,
    setName: dc.setName,
    rarity: dc.rarity,
    collectorNumber,
    attributes: { price: dc.price },
  };
}

const DEMO_TCGS: readonly CatalogTcgCode[] = CATALOG_GAMES;

function isSeededDemoGame(game: CatalogTcgCode): game is DemoTcg {
  return game === "pokemon" || game === "magic" || game === "yugioh";
}

function demoOwnedCards(tcg?: TcgCode): Card[] {
  const cards = new Map<string, Card>();
  for (const binder of store().binders) {
    for (const owned of binder.cards) {
      if (tcg && owned.tcg !== tcg) continue;
      cards.set(owned.cardId, {
        ...owned.cardData,
        id: owned.cardId,
        tcg: owned.tcg,
        name: owned.name,
        setCode: owned.cardData?.setCode ?? owned.setCode,
        setName: owned.cardData?.setName ?? owned.setName,
        rarity: owned.cardData?.rarity ?? owned.rarity,
      });
    }
  }
  return Array.from(cards.values());
}

function mergeOwnedCards(base: Card[], owned: Card[]): Card[] {
  const merged = new Map(base.map((card) => [card.id, card] as const));
  for (const card of owned) merged.set(card.id, card);
  return Array.from(merged.values());
}

function cardMatchesQuery(card: Card, query: string): boolean {
  const needle = normalizeCatalogText(query);
  if (!needle) return false;
  return normalizeCatalogText(
    [
      card.name,
      card.setName,
      card.setCode,
      card.collectorNumber,
      card.rarity,
      card.supertype,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" "),
  ).includes(needle);
}

function ownedCardSetCode(card: Card): string {
  const setCode = card.setCode ?? "";
  return setCode.includes("-") ? setCode.replace(/-[^-]+$/, "") : setCode;
}

function demoSetCode(card: DemoCard): string {
  return card.setCode.replace(/-[^-]+$/, "");
}

function demoSets(tcg?: TcgCode): TcgSet[] {
  const sets = new Map<
    string,
    {
      code: string;
      name: string;
      tcg: TcgCode;
      totalCards: number;
    }
  >();

  for (const card of DEMO_CARDS) {
    if (tcg && card.tcg !== tcg) continue;
    const key = `${card.tcg}:${card.setName}`;
    const existing = sets.get(key);
    if (existing) {
      existing.totalCards += 1;
    } else {
      sets.set(key, {
        code: demoSetCode(card),
        name: card.setName,
        tcg: card.tcg,
        totalCards: 1,
      });
    }
  }

  return Array.from(sets.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function demoOwnedSets(tcg?: TcgCode): TcgSet[] {
  const sets = new Map<string, TcgSet>();
  for (const card of demoOwnedCards(tcg)) {
    const code = ownedCardSetCode(card);
    if (!code) continue;
    const key = `${card.tcg}:${normalizeCatalogText(code)}`;
    const existing = sets.get(key);
    sets.set(key, {
      code,
      name: card.setName ?? code,
      tcg: card.tcg,
      totalCards: (existing?.totalCards ?? 0) + 1,
    });
  }
  return Array.from(sets.values());
}

async function demoSearchCards(query: string, tcg?: TcgCode): Promise<Card[]> {
  const games = tcg ? [tcg] : DEMO_TCGS;
  const gameResults = await Promise.all(
    games.map(async (game) => {
      if (!isCatalogGame(game)) return [];
      const installed = await isCatalogInstalled(game);
      if (installed) return searchCatalog(query, game);
      return isSeededDemoGame(game)
        ? searchDemoCards(query, game).map(demoCardToSearchResult)
        : [];
    }),
  );
  const owned = demoOwnedCards(tcg).filter((card) =>
    cardMatchesQuery(card, query),
  );
  return mergeOwnedCards(gameResults.flat(), owned);
}

async function demoCatalogSets(tcg?: TcgCode): Promise<TcgSet[]> {
  const games: readonly CatalogTcgCode[] = tcg
    ? isCatalogGame(tcg)
      ? [tcg]
      : []
    : DEMO_TCGS;
  const results = await Promise.all(
    games.map(async (game) =>
      (await isCatalogInstalled(game)) ? getCatalogSets(game) : demoSets(game),
    ),
  );
  const merged = new Map(
    results
      .flat()
      .map((set) => [`${set.tcg}:${normalizeCatalogText(set.code)}`, set] as const),
  );
  for (const set of demoOwnedSets(tcg)) {
    merged.set(`${set.tcg}:${normalizeCatalogText(set.code)}`, set);
  }
  return Array.from(merged.values());
}

async function demoCardsInSet(tcg: TcgCode, setCode: string): Promise<Card[]> {
  const normalizedSetCode = normalizeCatalogText(setCode);
  const base = isCatalogGame(tcg)
    ? (await isCatalogInstalled(tcg))
      ? await getCatalogCardsInSet(tcg, setCode)
      : DEMO_CARDS.filter(
          (card) =>
            card.tcg === tcg &&
            normalizeCatalogText(demoSetCode(card)) === normalizedSetCode,
        ).map(demoCardToSearchResult)
    : [];
  const owned = demoOwnedCards(tcg).filter(
    (card) =>
      normalizeCatalogText(ownedCardSetCode(card)) === normalizedSetCode,
  );
  return mergeOwnedCards(base, owned);
}

/* ------------------------------------------------------------------ */
/*  Router                                                              */
/* ------------------------------------------------------------------ */

/**
 * Main entry point — called by the fetch interceptor in demo-mode.ts.
 * Parses the URL path and method and dispatches to the right handler.
 */
export function handleDemoRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  // Strip query string for routing, but keep it for parsing params
  const [routePath, queryString] = path.split("?");
  const segments = routePath.replace(/^\//, "").split("/");

  // ── Auth ────────────────────────────────────────────────────────
  if (segments[0] === "auth") {
    return handleAuth(method, segments.slice(1), body);
  }

  // ── Collections / Binders ───────────────────────────────────────
  if (segments[0] === "collections") {
    return handleCollections(method, segments.slice(1), body);
  }

  // ── Wishlists ───────────────────────────────────────────────────
  if (segments[0] === "wishlists") {
    return handleWishlists(method, segments.slice(1), body);
  }

  // ── Users ───────────────────────────────────────────────────────
  if (segments[0] === "users") {
    return handleUsers(method, segments.slice(1), body);
  }

  // ── Settings ────────────────────────────────────────────────────
  if (segments[0] === "settings") {
    return handleSettings(method, segments.slice(1), body);
  }

  // ── Setup ───────────────────────────────────────────────────────
  if (segments[0] === "setup") {
    if (segments[1] === "setup-required" && method === "GET") {
      return json({ setupRequired: false });
    }
    if (segments[1] === "setup" && method === "POST") {
      store().init();
      return json({ user: demoAuthUser(), token: "demo-token-static" });
    }
    return notFound();
  }

  // ── Card Search ─────────────────────────────────────────────────
  if (segments[0] === "cards") {
    return handleCards(method, segments.slice(1), queryString);
  }

  return notFound(`Demo: unknown route ${method} ${path}`);
}

/* ------------------------------------------------------------------ */
/*  Auth handlers                                                       */
/* ------------------------------------------------------------------ */

function handleAuth(
  method: string,
  segments: string[],
  body?: unknown,
): Promise<Response> {
  const action = segments[0];

  if (action === "signup" && method === "POST") {
    store().init();
    return json({ user: demoAuthUser(), token: "demo-token-static" });
  }

  if (action === "login" && method === "POST") {
    store().init();
    return json({ user: demoAuthUser(), token: "demo-token-static" });
  }

  if (action === "logout" && method === "POST") {
    return noContent();
  }

  if (action === "me" && method === "GET") {
    return json({ user: demoAuthUser() });
  }

  if (action === "setup-required" && method === "GET") {
    return json({ setupRequired: false });
  }

  if (action === "setup" && method === "POST") {
    store().init();
    return json({ user: demoAuthUser(), token: "demo-token-static" });
  }

  return notFound();
}

/* ------------------------------------------------------------------ */
/*  Collections handlers                                                */
/* ------------------------------------------------------------------ */

async function handleCollections(
  method: string,
  segments: string[],
  body?: unknown,
): Promise<Response> {
  // GET /collections
  if (segments.length === 0 && method === "GET") {
    store().init();
    await store().enrichCardsFromCatalog();
    return json(store().binders.map(toBinder));
  }

  // POST /collections
  if (segments.length === 0 && method === "POST") {
    const data = body as {
      name: string;
      description?: string;
      colorHex?: string;
    };
    const id = store().addBinder(
      data.name,
      data.colorHex ? `#${data.colorHex}` : undefined,
    );
    const binder = store().binders.find((b: DemoBinder) => b.id === id)!;
    return json(toBinder(binder));
  }

  // GET/POST /collections/tags
  if (segments[0] === "tags") {
    if (method === "GET") return json([]);
    if (method === "POST") {
      const data = body as { label: string; colorHex?: string };
      const now = new Date().toISOString();
      return json({
        id: `demo-tag-${Date.now()}`,
        label: data.label,
        colorHex: data.colorHex || "cccccc",
        createdAt: now,
        updatedAt: now,
      });
    }
    return notFound();
  }

  // POST /collections/cards  (library add)
  if (segments[0] === "cards" && segments.length === 1 && method === "POST") {
    return handleAddCard("__library__", body);
  }

  const collectionId = segments[0];

  // PATCH /collections/:id
  if (segments.length === 1 && method === "PATCH") {
    const data = body as {
      name?: string;
      description?: string;
      colorHex?: string;
    };
    if (data.name) store().renameBinder(collectionId, data.name);
    const binder = store().binders.find(
      (b: DemoBinder) => b.id === collectionId,
    );
    return binder ? json(toBinder(binder)) : notFound("Collection not found");
  }

  // DELETE /collections/:id
  if (segments.length === 1 && method === "DELETE") {
    store().removeBinder(collectionId);
    return noContent();
  }

  // POST /collections/:id/cards
  if (segments[1] === "cards" && segments.length === 2 && method === "POST") {
    return handleAddCard(collectionId, body);
  }

  // PATCH /collections/:id/cards/:cardId
  if (segments[1] === "cards" && segments.length === 3 && method === "PATCH") {
    const cardId = segments[2];
    const updated = store().updateCardInBinder(
      collectionId,
      cardId,
      body as UpdateCardInput,
    );
    const binder = store().binders.find(
      (entry: DemoBinder) => entry.id === collectionId,
    );
    if (!binder || !updated) return notFound("Card not found");
    return json(
      toCollectionCard(updated, binder.id, binder.name, binder.color),
    );
  }

  // DELETE /collections/:id/cards/:cardId
  if (segments[1] === "cards" && segments.length === 3 && method === "DELETE") {
    const cardId = segments[2];
    store().removeCardFromBinder(collectionId, cardId);
    return noContent();
  }

  return notFound();
}

function handleAddCard(collectionId: string, body: unknown): Promise<Response> {
  const data = body as AddCardInput;
  const demoCard: DemoOwnedCard | null =
    DEMO_CARDS.find((c) => c.id === data.cardId) ||
    (data.cardData
      ? {
          id: data.cardData.externalId || data.cardId,
          tcg: data.cardData.tcg,
          name: data.cardData.name,
          setCode: data.cardData.setCode || "",
          setName: data.cardData.setName || "",
          rarity: data.cardData.rarity || "Common",
          price: data.price || 0,
        }
      : null);

  if (!demoCard) return json({ message: "Card not found" }, 400);

  const targetBinder =
    collectionId === "__library__" ? store().binders[0]?.id : collectionId;

  if (targetBinder) {
    store().addCardToBinder(targetBinder, demoCard, data.quantity ?? 1, {
      cardData: data.cardData,
      copy: {
        condition: data.condition,
        language: data.language,
        notes: data.notes,
        price: data.price,
        acquisitionPrice: data.acquisitionPrice,
        isFoil: data.isFoil,
        finishCode: data.finishCode,
        finishLabel: data.finishLabel,
        edition: data.edition,
        stamp: data.stamp,
        isSealedPromo: data.isSealedPromo,
        isOversized: data.isOversized,
        isPeelOff: data.isPeelOff,
        isSigned: data.isSigned,
        isAltered: data.isAltered,
        gradingCompany: data.gradingCompany,
        gradingScore: data.gradingScore,
        certNumber: data.certNumber,
        storageLocation: data.storageLocation,
      },
    });
  }

  return json({ success: true });
}

/* ------------------------------------------------------------------ */
/*  Wishlists handlers                                                  */
/* ------------------------------------------------------------------ */

async function handleWishlists(
  method: string,
  segments: string[],
  body?: unknown,
): Promise<Response> {
  // GET /wishlists
  if (segments.length === 0 && method === "GET") {
    store().init();
    await store().enrichCardsFromCatalog();
    return json(store().wishlists.map(toWishlist));
  }

  // POST /wishlists
  if (segments.length === 0 && method === "POST") {
    const data = body as {
      name: string;
      description?: string;
      colorHex?: string;
    };
    const id = store().addWishlist(data.name, data.description);
    const w = store().wishlists.find((wl: DemoWishlist) => wl.id === id)!;
    return json(toWishlist(w));
  }

  const wishlistId = segments[0];

  // GET /wishlists/:id
  if (segments.length === 1 && method === "GET") {
    await store().enrichCardsFromCatalog();
    const w = store().wishlists.find(
      (wl: DemoWishlist) => wl.id === wishlistId,
    );
    return w ? json(toWishlist(w)) : notFound("Wishlist not found");
  }

  // PATCH /wishlists/:id
  if (segments.length === 1 && method === "PATCH") {
    const w = store().wishlists.find(
      (wl: DemoWishlist) => wl.id === wishlistId,
    );
    return w ? json(toWishlist(w)) : notFound("Wishlist not found");
  }

  // DELETE /wishlists/:id
  if (segments.length === 1 && method === "DELETE") {
    store().removeWishlist(wishlistId);
    return noContent();
  }

  // POST /wishlists/:id/cards
  if (segments[1] === "cards" && segments.length === 2 && method === "POST") {
    const data = body as AddWishlistCardInput;
    const demoCard: DemoOwnedCard = DEMO_CARDS.find(
      (c) => c.id === data.externalId,
    ) || {
      id: data.externalId,
      tcg: data.tcg,
      name: data.name,
      setCode: data.setCode || "",
      setName: data.setName || "",
      rarity: data.rarity || "Common",
      price: 0,
    };
    store().addCardToWishlist(wishlistId, demoCard, data);
    const w = store().wishlists.find(
      (wl: DemoWishlist) => wl.id === wishlistId,
    )!;
    const card = w.cards[w.cards.length - 1];
    return json(toWishlistCard(card));
  }

  // POST /wishlists/:id/cards/batch
  if (
    segments[1] === "cards" &&
    segments[2] === "batch" &&
    segments.length === 3 &&
    method === "POST"
  ) {
    const data = body as { cards: AddWishlistCardInput[] };
    for (const card of data.cards ?? []) {
      const demoCard: DemoOwnedCard = DEMO_CARDS.find(
        (c) => c.id === card.externalId,
      ) || {
        id: card.externalId,
        tcg: card.tcg,
        name: card.name,
        setCode: card.setCode || "",
        setName: card.setName || "",
        rarity: card.rarity || "Common",
        price: 0,
      };
      store().addCardToWishlist(wishlistId, demoCard, card);
    }
    const w = store().wishlists.find(
      (wl: DemoWishlist) => wl.id === wishlistId,
    );
    return w ? json(toWishlist(w)) : notFound("Wishlist not found");
  }

  // DELETE /wishlists/:id/cards/:cardId
  if (segments[1] === "cards" && segments.length === 3 && method === "DELETE") {
    store().removeCardFromWishlist(wishlistId, segments[2]);
    return noContent();
  }

  // POST /wishlists/:id/rules
  if (segments[1] === "rules" && segments.length === 2 && method === "POST") {
    const data = body as CreateWishlistRuleInput;
    const rule = store().addWishlistRule(wishlistId, {
      type: data.type,
      tcg: data.tcg,
      query: data.query,
      setCode: data.setCode,
      setName: data.setName,
      includeAllPrintings: data.includeAllPrintings ?? true,
      autoSync: data.autoSync ?? true,
    });
    return rule ? json(rule) : notFound("Wishlist not found");
  }

  // PATCH /wishlists/:id/rules/:ruleId
  if (segments[1] === "rules" && segments.length === 3 && method === "PATCH") {
    const data = body as UpdateWishlistRuleInput;
    const rule = store().updateWishlistRule(wishlistId, segments[2], data);
    return rule ? json(rule) : notFound("Wishlist rule not found");
  }

  // DELETE /wishlists/:id/rules/:ruleId
  if (segments[1] === "rules" && segments.length === 3 && method === "DELETE") {
    store().removeWishlistRule(wishlistId, segments[2]);
    return noContent();
  }

  return notFound();
}

/* ------------------------------------------------------------------ */
/*  Users handlers                                                      */
/* ------------------------------------------------------------------ */

function handleUsers(
  method: string,
  segments: string[],
  body?: unknown,
): Promise<Response> {
  // GET /users/me
  if (segments[0] === "me" && segments.length === 1 && method === "GET") {
    const { profile } = store();
    return json({
      id: DEMO_USER_ID,
      email: profile.email,
      username: profile.username,
      isAdmin: true,
      showCardNumbers: true,
      showPricing: true,
      createdAt: "2024-01-01T00:00:00Z",
    });
  }

  // PATCH /users/me
  if (segments[0] === "me" && segments.length === 1 && method === "PATCH") {
    const data = body as { username?: string; email?: string };
    store().updateProfile(data);
    const { profile } = store();
    return json({
      id: DEMO_USER_ID,
      email: profile.email,
      username: profile.username,
      isAdmin: true,
      showCardNumbers: true,
      showPricing: true,
    });
  }

  // POST /users/me/change-password
  if (
    segments[0] === "me" &&
    segments[1] === "change-password" &&
    method === "POST"
  ) {
    return json({ success: true });
  }

  // GET /users/me/preferences
  if (
    segments[0] === "me" &&
    segments[1] === "preferences" &&
    method === "GET"
  ) {
    return json(store().getPreferences());
  }

  // PATCH /users/me/preferences
  if (
    segments[0] === "me" &&
    segments[1] === "preferences" &&
    method === "PATCH"
  ) {
    const data = body as Partial<UserPreferences>;
    return json(store().updatePreferences(data));
  }

  return notFound();
}

/* ------------------------------------------------------------------ */
/*  Settings handlers                                                   */
/* ------------------------------------------------------------------ */

function handleSettings(
  method: string,
  segments: string[],
  body?: unknown,
): Promise<Response> {
  const defaults = {
    id: 1,
    publicDashboard: true,
    publicCollections: true,
    requireAuth: false,
    appName: "TCGer Demo",
    updatedAt: new Date().toISOString(),
  };

  if (segments.length === 0 && method === "GET") return json(defaults);
  if (segments.length === 0 && method === "PATCH")
    return json({ ...defaults, ...(body as Record<string, unknown>) });

  if (segments[0] === "source-defaults" && method === "GET") {
    return json({
      scryfall: {
        url: "https://api.scryfall.com",
        label: "Scryfall (Magic)",
      },
      yugioh: {
        url: "https://db.ygoprodeck.com/api/v7",
        label: "YGOPRODeck (Yu-Gi-Oh)",
      },
      pokemon: {
        url: "https://api.scrydex.com/pokemon/v1",
        label: "Scrydex (Pok\u00e9mon)",
      },
      tcgdex: {
        url: "https://api.tcgdex.net/v2/en",
        label: "TCGdex (Pok\u00e9mon Variants)",
      },
    });
  }

  if (segments[0] === "test-source" && method === "POST") {
    const source = (body as { source?: unknown } | undefined)?.source;
    if (
      typeof source !== "string" ||
      !["scryfall", "yugioh", "pokemon", "tcgdex"].includes(source)
    ) {
      return json({ message: "Unsupported source" }, 400);
    }
    return json({ ok: true, latencyMs: 0 });
  }

  return notFound();
}

/* ------------------------------------------------------------------ */
/*  Cards handlers                                                      */
/* ------------------------------------------------------------------ */

async function handleCards(
  method: string,
  segments: string[],
  queryString?: string,
): Promise<Response> {
  // GET /cards/sets?tcg=...
  if (segments[0] === "sets" && segments.length === 1 && method === "GET") {
    const params = new URLSearchParams(queryString || "");
    const tcg = params.get("tcg") as TcgCode | null;
    const sets = await demoCatalogSets(tcg ?? undefined);
    return json({ sets, total: sets.length });
  }

  // GET /cards/sets/:tcg/:setCode
  if (segments[0] === "sets" && segments.length === 3 && method === "GET") {
    const tcg = segments[1] as TcgCode;
    const setCode = decodeURIComponent(segments[2]);
    const cards = await demoCardsInSet(tcg, setCode);
    return json({ cards, total: cards.length });
  }

  // GET /cards/search?query=... and GET /cards/search/all?query=...
  // The demo dataset is small enough that the exhaustive variant can reuse the
  // same search — there are no extra pages to page through.
  if (segments[0] === "search" && method === "GET") {
    const params = new URLSearchParams(queryString || "");
    const query = params.get("query") || "";
    const tcg = params.get("tcg") as TcgCode | undefined;
    const results = await demoSearchCards(query, tcg);
    return json({ cards: results });
  }

  // GET /cards/:tcg/:cardId/prints
  if (segments.length === 3 && segments[2] === "prints" && method === "GET") {
    return json({ type: "simple", prints: [] });
  }

  return notFound();
}

/* ------------------------------------------------------------------ */
/*  Re-export demoLogin for the demo login page                         */
/* ------------------------------------------------------------------ */

export function demoLogin() {
  store().init();
  return { user: demoAuthUser(), token: "demo-token-static" };
}
