/**
 * Demo route handler — maps URL path + HTTP method to demo store operations
 * and returns real Response objects, so the API files see no difference.
 */

import {
  useDemoStore,
  whenDemoStoreHydrated,
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
  searchCatalogByArtist,
  searchCatalogByCollectionTag,
} from "@/lib/catalog/catalog-search";
import type { TcgCode } from "@/types/card";
import type {
  AddCardInput,
  AddWishlistCardInput,
  Card,
  CollectionGuideItemResponse,
  CollectionGuideResponse,
  CollectionCardCopy,
  CreateWishlistRuleInput,
  TcgSet,
  UpdateCardInput,
  UpdateWishlistRuleInput,
  UserPreferences,
} from "@tcg/api-types";
import { systemGuideDefinitions } from "@/lib/guides/system-guides.generated";

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

function demoCollectionGuides(): CollectionGuideResponse[] {
  const definitions: Array<
    Omit<CollectionGuideResponse, "followed" | "wishlistId">
  > = systemGuideDefinitions.map((guide) => ({
    id: `demo-guide-${guide.slug}`,
    slug: guide.slug,
    title: guide.title,
    description: guide.description,
    tcg: guide.tcg,
    category: guide.category,
    curatorName: guide.curatorName,
    tags: [...guide.tags],
    version: guide.version,
    featured: guide.featured,
    rule: {
      type: guide.ruleType,
      tcg: guide.tcg,
      query: "ruleQuery" in guide ? guide.ruleQuery : undefined,
      includeAllPrintings: guide.includeAllPrintings,
    },
    cardCountHint: "cardCountHint" in guide ? guide.cardCountHint : undefined,
  }));
  return definitions.map((guide) => {
    const wishlist = store().wishlists.find((candidate) =>
      guide.rule.type === "manual"
        ? candidate.name === guide.title
        : (candidate.rules ?? []).some(
            (rule) =>
              rule.type === guide.rule.type &&
              rule.tcg === guide.rule.tcg &&
              rule.query === guide.rule.query &&
              rule.setCode === guide.rule.setCode,
          ),
    );
    return { ...guide, followed: Boolean(wishlist), wishlistId: wishlist?.id };
  });
}

function demoConnectedArtItems(): CollectionGuideItemResponse[] {
  const cards = [
    ["GG26", "Riolu"],
    ["GG27", "Swablu"],
    ["GG28", "Duskull"],
    ["GG29", "Bidoof"],
    ["GG30", "Pikachu"],
    ["GG31", "Turtwig"],
    ["GG32", "Paras"],
    ["GG33", "Poochyena"],
    ["GG34", "Mareep"],
  ] as const;
  return cards.map(([collectorNumber, name], position) => ({
    id: `demo-connected-${collectorNumber}`,
    guideId: "demo-guide-pokemon-crown-zenith-connected-art",
    tcg: "pokemon",
    externalId: `swsh12.5gg-${collectorNumber}`,
    name,
    setCode: "swsh12.5gg",
    setName: "Crown Zenith Galarian Gallery",
    collectorNumber,
    rarity: "Rare",
    artist: "Kouki Saitou",
    imageUrl: `https://images.pokemontcg.io/swsh12pt5gg/${collectorNumber}_hires.png`,
    imageUrlSmall: `https://images.pokemontcg.io/swsh12pt5gg/${collectorNumber}.png`,
    groupKey: "crown-zenith-nine-card-scene",
    groupLabel: "Crown Zenith nine-card scene",
    groupOrder: 0,
    position,
    provenanceUrl:
      "https://bulbapedia.bulbagarden.net/wiki/Bidoof_(Crown_Zenith_111)",
  }));
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
    acquiredAt: card.addedAt,
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
      .map(
        (set) => [`${set.tcg}:${normalizeCatalogText(set.code)}`, set] as const,
      ),
  );
  // Owned-derived sets report the number of cards OWNED as totalCards, which is
  // not the set's size. Letting them overwrite a catalog entry made every set
  // the demo owns cards from report N/N — Modern Horizons 2 showed 6/6 complete
  // in the set list while its detail page correctly said 6/7. So only fill in
  // sets the catalog does not already describe, and when the size is genuinely
  // unknown report 0 so the UI says "Total unavailable" instead of claiming
  // completion.
  for (const set of demoOwnedSets(tcg)) {
    const key = `${set.tcg}:${normalizeCatalogText(set.code)}` as const;
    if (merged.has(key)) continue;
    merged.set(key, { ...set, totalCards: 0 });
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
export async function handleDemoRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  // The demo store now hydrates from IndexedDB, which is asynchronous where
  // localStorage was not. Handlers below call init() and read the store in the
  // same tick, so without waiting here the first request after a cold load
  // would answer from a store that is empty only because the read has not
  // landed yet — a returning visitor would see an empty collection flash, and
  // init() could seed over their data. Resolves immediately once hydrated, and
  // never rejects: a storage failure resolves with nothing loaded.
  await whenDemoStoreHydrated();

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

  if (segments[0] === "guides") {
    return handleGuides(method, segments.slice(1), body, queryString);
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

async function handleGuides(
  method: string,
  segments: string[],
  body?: unknown,
  queryString?: string,
): Promise<Response> {
  store().init();
  const guides = demoCollectionGuides();
  if (segments.length === 0 && method === "GET") return json(guides);

  if (segments[0] === "cards" && segments.length === 1 && method === "GET") {
    const params = new URLSearchParams(queryString || "");
    const query = normalizeCatalogText(params.get("query") || "");
    const tcg = params.get("tcg");
    const category = params.get("category");
    const guideSlug = params.get("guide");
    const ownership = params.get("ownership") || "all";
    const selectedGuides = guides.filter(
      (guide) =>
        (!tcg || guide.tcg === tcg) &&
        (!category || guide.category === category) &&
        (!guideSlug || guide.slug === guideSlug),
    );
    const rows: Array<{
      card: Card;
      owned: boolean;
      ownedQuantity: number;
      matchedGuides: Array<{
        guideId: string;
        slug: string;
        title: string;
        category: CollectionGuideResponse["category"];
        tags: string[];
        groupKey?: string;
        groupLabel?: string;
        groupOrder?: number;
        position?: number;
      }>;
    }> = [];
    for (const guide of selectedGuides) {
      const cards =
        guide.rule.type === "manual"
          ? demoConnectedArtItems().map((item) => ({
              card: {
                id: item.externalId,
                tcg: item.tcg,
                name: item.name,
                setCode: item.setCode,
                setName: item.setName,
                collectorNumber: item.collectorNumber,
                rarity: item.rarity,
                artist: item.artist,
                imageUrl: item.imageUrl,
                imageUrlSmall: item.imageUrlSmall,
              } satisfies Card,
              item,
            }))
          : guide.rule.type === "name" && guide.rule.query
            ? (await demoSearchCards(guide.rule.query, guide.tcg)).map(
                (card) => ({ card, item: undefined }),
              )
            : guide.rule.type === "tag" &&
                guide.rule.query &&
                isCatalogGame(guide.tcg)
              ? (
                  await searchCatalogByCollectionTag(
                    guide.rule.query,
                    guide.tcg,
                    5000,
                  )
                ).map((card) => ({ card, item: undefined }))
              : [];
      for (const { card, item } of cards) {
        const searchText = normalizeCatalogText(
          [
            card.name,
            card.setName,
            card.artist,
            guide.title,
            ...guide.tags,
            item?.groupLabel,
          ]
            .filter(Boolean)
            .join(" "),
        );
        if (query && !searchText.includes(query)) continue;
        const ownedQuantity = store().getOwnedQuantity(card.id);
        const owned = ownedQuantity > 0;
        if (ownership === "owned" && !owned) continue;
        if (ownership === "missing" && owned) continue;
        rows.push({
          card,
          owned,
          ownedQuantity,
          matchedGuides: [
            {
              guideId: guide.id,
              slug: guide.slug,
              title: guide.title,
              category: guide.category,
              tags: guide.tags,
              groupKey: item?.groupKey,
              groupLabel: item?.groupLabel,
              groupOrder: item?.groupOrder,
              position: item?.position,
            },
          ],
        });
      }
    }
    return json({ results: rows, total: rows.length, failedGuideSlugs: [] });
  }

  const slug = decodeURIComponent(segments[0] ?? "");
  const guide = guides.find((candidate) => candidate.slug === slug);
  if (!guide) return notFound("Collection guide not found");
  if (segments.length === 1 && method === "GET") return json(guide);
  if (segments[1] === "items" && segments.length === 2 && method === "GET") {
    return json(guide.rule.type === "manual" ? demoConnectedArtItems() : []);
  }

  if (segments[1] === "follow" && segments.length === 2 && method === "POST") {
    if (guide.wishlistId) {
      return json({ guide, wishlistId: guide.wishlistId, created: false });
    }
    const name =
      (body as { wishlistName?: string } | undefined)?.wishlistName?.trim() ||
      guide.title;
    const wishlistId = store().addWishlist(
      name,
      `Following the “${guide.title}” collection guide.`,
    );
    if (guide.rule.type === "manual") {
      for (const item of demoConnectedArtItems()) {
        store().addCardToWishlist(
          wishlistId,
          {
            id: item.externalId,
            tcg: item.tcg,
            name: item.name,
            setCode: `${item.setCode}-${item.collectorNumber}`,
            setName: item.setName ?? item.setCode ?? "Unknown set",
            rarity: item.rarity ?? "Unknown",
            price: 0,
          },
          {
            externalId: item.externalId,
            tcg: item.tcg,
            name: item.name,
            setCode: item.setCode,
            setName: item.setName,
            rarity: item.rarity,
            artist: item.artist,
            imageUrl: item.imageUrl,
            imageUrlSmall: item.imageUrlSmall,
            collectorNumber: item.collectorNumber,
          },
        );
      }
    } else {
      store().addWishlistRule(wishlistId, {
        type: guide.rule.type,
        tcg: guide.rule.tcg,
        query: guide.rule.query,
        setCode: guide.rule.setCode,
        setName: guide.rule.setName,
        includeAllPrintings: guide.rule.includeAllPrintings,
        autoSync: true,
      });
    }
    const followed = demoCollectionGuides().find(
      (candidate) => candidate.slug === slug,
    )!;
    return json({ guide: followed, wishlistId, created: true }, 201);
  }
  return notFound();
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
    const id = await store().addBinder(
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

  // GET /collections/:id
  // The server serves this (convex/http.ts) and the demo did not, so a client
  // asking for a single binder got a 404 in demo mode only.
  if (segments.length === 1 && method === "GET") {
    store().init();
    await store().enrichCardsFromCatalog();
    const binder = store().binders.find(
      (b: DemoBinder) => b.id === collectionId,
    );
    return binder ? json(toBinder(binder)) : notFound("Collection not found");
  }

  // PATCH /collections/:id
  if (segments.length === 1 && method === "PATCH") {
    const data = body as {
      name?: string;
      description?: string;
      colorHex?: string;
    };
    if (data.name) await store().renameBinder(collectionId, data.name);
    const binder = store().binders.find(
      (b: DemoBinder) => b.id === collectionId,
    );
    return binder ? json(toBinder(binder)) : notFound("Collection not found");
  }

  // DELETE /collections/:id
  if (segments.length === 1 && method === "DELETE") {
    await store().removeBinder(collectionId);
    return noContent();
  }

  // POST /collections/:id/cards
  if (segments[1] === "cards" && segments.length === 2 && method === "POST") {
    return handleAddCard(collectionId, body);
  }

  // PATCH /collections/:id/cards/:cardId
  if (segments[1] === "cards" && segments.length === 3 && method === "PATCH") {
    const cardId = segments[2];
    const patch = body as UpdateCardInput;
    const updated = await store().updateCardInBinder(
      collectionId,
      cardId,
      patch,
    );
    // On a move the card now lives in the target binder, so the response has
    // to describe that binder — reporting the source would tell the UI the
    // card is still where it started.
    const resultBinderId = patch?.targetBinderId ?? collectionId;
    const binder = store().binders.find(
      (entry: DemoBinder) => entry.id === resultBinderId,
    );
    if (!binder || !updated) return notFound("Card not found");
    return json(
      toCollectionCard(updated, binder.id, binder.name, binder.color),
    );
  }

  // DELETE /collections/:id/cards/:cardId
  if (segments[1] === "cards" && segments.length === 3 && method === "DELETE") {
    const cardId = segments[2];
    await store().removeCardFromBinder(collectionId, cardId);
    return noContent();
  }

  return notFound();
}

async function handleAddCard(
  collectionId: string,
  body: unknown,
): Promise<Response> {
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
    await store().addCardToBinder(targetBinder, demoCard, data.quantity ?? 1, {
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
  if (
    segments[0] === "search" &&
    segments[1] === "artist" &&
    method === "GET"
  ) {
    const params = new URLSearchParams(queryString || "");
    const artist = params.get("artist") || "";
    const tcg = (params.get("tcg") || "pokemon") as CatalogTcgCode;
    const limit = Number.parseInt(params.get("limit") || "1000", 10);
    const cards =
      isCatalogGame(tcg) && (await isCatalogInstalled(tcg))
        ? await searchCatalogByArtist(artist, tcg, limit)
        : [];
    return json({ cards, total: cards.length });
  }

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
