import { ConvexError } from "convex/values";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./betterAuth/auth";

const http = httpRouter();
authComponent.registerRoutes(http, createAuth);

const LIBRARY_COLLECTION_ID = "__library__";

type BridgeIdentity = {
  subject: string;
  email?: string;
  name?: string;
  username?: string;
};

type NativeTag = {
  id: string;
  label: string;
  colorHex: string;
  createdAt: string;
  updatedAt: string;
};

type NativeEntry = {
  id: string;
  binderId: string;
  cardId: string;
  card: {
    id: string;
    externalId: string;
    tcg: "magic" | "pokemon" | "yugioh";
    name: string;
    setCode?: string;
    setName?: string;
    rarity?: string;
    collectorNumber?: string;
    releasedAt?: string;
    imageUrl?: string;
    imageUrlSmall?: string;
  };
  quantity: number;
  condition?: string;
  language?: string;
  notes?: string;
  price?: number;
  acquisitionPrice?: number;
  serialNumber?: string;
  acquiredAt?: string;
  isFoil?: boolean;
  isSigned?: boolean;
  isAltered?: boolean;
  imageUrls?: string[];
  tags: NativeTag[];
  createdAt: string;
  updatedAt: string;
};

type NativeBinderDetail = {
  id: string;
  userId: string;
  kind: "binder" | "library";
  name: string;
  description?: string;
  colorHex?: string;
  entryCount: number;
  entries: NativeEntry[];
  createdAt: string;
  updatedAt: string;
};

type NativeWishlistCard = {
  id: string;
  externalId: string;
  tcg: "magic" | "pokemon" | "yugioh";
  name: string;
  setCode?: string;
  setName?: string;
  rarity?: string;
  imageUrl?: string;
  imageUrlSmall?: string;
  setSymbolUrl?: string;
  setLogoUrl?: string;
  collectorNumber?: string;
  notes?: string;
  owned: boolean;
  ownedQuantity: number;
  createdAt: string;
};

type NativeWishlist = {
  id: string;
  name: string;
  description?: string;
  colorHex?: string;
  cards: NativeWishlistCard[];
  totalCards: number;
  ownedCards: number;
  completionPercent: number;
  createdAt: string;
  updatedAt: string;
};

function json(payload: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers
    }
  });
}

function textResponse(payload: string, status = 200, headers?: Record<string, string>) {
  return new Response(payload, {
    status,
    headers
  });
}

function noContent() {
  return new Response(null, { status: 204 });
}

function errorJson(status: number, error: string, message: string) {
  return json({ error, message }, status);
}

function statusFromConvexError(error: ConvexError<any>) {
  const code = String(error.data?.code ?? "");
  if (code === "UNAUTHORIZED" || code === "UNAUTHENTICATED" || code === "USER_NOT_PROVISIONED") {
    return 401;
  }
  if (code === "FORBIDDEN") {
    return 403;
  }
  if (code === "CONFLICT") {
    return 409;
  }
  if (code === "NOT_FOUND") {
    return 404;
  }
  return 400;
}

function handleConvexError(error: unknown, fallback: string) {
  if (error instanceof ConvexError) {
    return errorJson(
      statusFromConvexError(error),
      String(error.data?.code ?? "BAD_REQUEST"),
      String(error.data?.message ?? fallback)
    );
  }
  throw error;
}

async function parseJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function getBridgeIdentity(request: Request): BridgeIdentity | null {
  const authorization = request.headers.get("authorization");
  const subject = request.headers.get("x-tcger-user-id");
  if (!authorization || !subject) {
    return null;
  }

  return {
    subject,
    email: request.headers.get("x-tcger-user-email") ?? undefined,
    username: request.headers.get("x-tcger-username") ?? undefined,
    name:
      request.headers.get("x-tcger-name") ??
      request.headers.get("x-tcger-username") ??
      undefined
  };
}

async function requireBridgeIdentity(ctx: any, request: Request) {
  const identity = getBridgeIdentity(request);
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Authorization and x-tcger-user-id are required"
    });
  }
  await ctx.runMutation(internal.bridge.ensureViewer, identity);
  return identity;
}

async function requireBridgeAdmin(ctx: any, identity: BridgeIdentity) {
  const viewer = await ctx.runQuery(internal.bridge.getViewerProfile, {
    subject: identity.subject
  });

  if (!viewer.isAdmin) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Admin access required"
    });
  }

  return viewer;
}

function toLegacyBinderId(binder: NativeBinderDetail) {
  return binder.kind === "library" ? LIBRARY_COLLECTION_ID : binder.id;
}

function toLegacyTags(tags: NativeTag[]) {
  return tags.map((tag) => ({
    id: tag.id,
    label: tag.label,
    colorHex: tag.colorHex
  }));
}

function expandLegacyCopies(entry: NativeEntry) {
  const copyCount = Math.max(1, entry.quantity);
  return Array.from({ length: copyCount }, (_, index) => ({
    id: index === 0 ? entry.id : `${entry.id}#${index + 1}`,
    condition: entry.condition,
    language: entry.language,
    notes: entry.notes,
    price: entry.price,
    acquisitionPrice: entry.acquisitionPrice,
    serialNumber: entry.serialNumber,
    acquiredAt: entry.acquiredAt,
    isFoil: entry.isFoil,
    isSigned: entry.isSigned,
    isAltered: entry.isAltered,
    imageUrls: entry.imageUrls ?? [],
    tags: toLegacyTags(entry.tags)
  }));
}

function toLegacyBinder(binder: NativeBinderDetail) {
  const grouped = new Map<string, any>();

  for (const entry of binder.entries) {
    const key = entry.cardId;
    const copies = expandLegacyCopies(entry);
    const existing = grouped.get(key);

    if (existing) {
      existing.quantity += copies.length;
      existing.price ??= entry.price;
      existing.acquisitionPrice ??= entry.acquisitionPrice;
      existing.condition ??= entry.condition;
      existing.language ??= entry.language;
      existing.notes ??= entry.notes;
      existing.serialNumber ??= entry.serialNumber;
      existing.acquiredAt ??= entry.acquiredAt;
      existing.isFoil ??= entry.isFoil;
      existing.isSigned ??= entry.isSigned;
      existing.isAltered ??= entry.isAltered;
      existing.copies.push(...copies);
      continue;
    }

    grouped.set(key, {
      id: copies[0]?.id ?? entry.id,
      cardId: entry.cardId,
      externalId: entry.card.externalId,
      name: entry.card.name,
      tcg: entry.card.tcg,
      setCode: entry.card.setCode,
      setName: entry.card.setName,
      rarity: entry.card.rarity,
      collectorNumber: entry.card.collectorNumber,
      releasedAt: entry.card.releasedAt,
      imageUrl: entry.card.imageUrl,
      imageUrlSmall: entry.card.imageUrlSmall,
      quantity: copies.length,
      condition: entry.condition,
      language: entry.language,
      notes: entry.notes,
      price: entry.price,
      acquisitionPrice: entry.acquisitionPrice,
      serialNumber: entry.serialNumber,
      acquiredAt: entry.acquiredAt,
      binderId: toLegacyBinderId(binder),
      binderName: binder.name,
      binderColorHex: binder.colorHex,
      copies
    });
  }

  return {
    id: toLegacyBinderId(binder),
    name: binder.name,
    description: binder.description ?? "",
    colorHex: binder.colorHex,
    cards: Array.from(grouped.values()),
    createdAt: binder.createdAt,
    updatedAt: binder.updatedAt
  };
}

function findLegacyCardByCopyId(binder: ReturnType<typeof toLegacyBinder>, copyId: string) {
  return binder.cards.find((card) => card.copies.some((copy: { id: string }) => copy.id === copyId)) ?? null;
}

async function resolveActualBinderId(ctx: any, identity: BridgeIdentity, binderId: string) {
  if (binderId !== LIBRARY_COLLECTION_ID) {
    return binderId;
  }
  return await ctx.runQuery(internal.bridge.libraryBinderId, {
    subject: identity.subject
  });
}

function asCollectionEntryId(value: string) {
  return value as any;
}

function asWishlistId(value: string) {
  return value as any;
}

function asWishlistCardId(value: string) {
  return value as any;
}

function toExportRows(binders: NativeBinderDetail[]) {
  return binders.flatMap((binder) =>
    binder.entries.flatMap((entry) =>
      expandLegacyCopies(entry).map(() => ({
        binderName: binder.name,
        cardName: entry.card.name,
        tcg: entry.card.tcg,
        setCode: entry.card.setCode ?? null,
        setName: entry.card.setName ?? null,
        rarity: entry.card.rarity ?? null,
        externalId: entry.card.externalId,
        condition: entry.condition ?? null,
        language: entry.language ?? null,
        notes: entry.notes ?? null,
        price: entry.price ?? null,
        acquisitionPrice: entry.acquisitionPrice ?? null,
        serialNumber: entry.serialNumber ?? null,
        isFoil: Boolean(entry.isFoil),
        isSigned: Boolean(entry.isSigned),
        isAltered: Boolean(entry.isAltered),
        tags: entry.tags.map((tag) => tag.label),
        acquiredAt: entry.acquiredAt ?? null,
        createdAt: entry.createdAt
      }))
    )
  );
}

function escapeCsvField(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return "";
  }
  const stringValue = String(value);
  if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

function toCsv(rows: ReturnType<typeof toExportRows>) {
  const headers = [
    "Binder",
    "Card Name",
    "TCG",
    "Set Code",
    "Set Name",
    "Rarity",
    "External ID",
    "Condition",
    "Language",
    "Notes",
    "Price",
    "Acquisition Price",
    "Serial Number",
    "Foil",
    "Signed",
    "Altered",
    "Tags",
    "Acquired At",
    "Created At"
  ];

  const records = rows.map((row) =>
    [
      escapeCsvField(row.binderName),
      escapeCsvField(row.cardName),
      escapeCsvField(row.tcg),
      escapeCsvField(row.setCode),
      escapeCsvField(row.setName),
      escapeCsvField(row.rarity),
      escapeCsvField(row.externalId),
      escapeCsvField(row.condition),
      escapeCsvField(row.language),
      escapeCsvField(row.notes),
      escapeCsvField(row.price),
      escapeCsvField(row.acquisitionPrice),
      escapeCsvField(row.serialNumber),
      row.isFoil ? "Yes" : "No",
      row.isSigned ? "Yes" : "No",
      row.isAltered ? "Yes" : "No",
      escapeCsvField(row.tags.join("; ")),
      escapeCsvField(row.acquiredAt),
      escapeCsvField(row.createdAt)
    ].join(",")
  );

  return [headers.join(","), ...records].join("\n");
}

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () =>
    Response.json({
      status: "ok",
      backend: "convex-native",
      capabilities: ["auth", "users", "settings", "binders", "collections", "tags", "wishlists"]
    })
  )
});

http.route({
  path: "/setup/setup-required",
  method: "GET",
  handler: httpAction(async (ctx) => {
    try {
      const setupRequired = await ctx.runQuery(internal.bridge.getSetupRequired, {});
      return json({ setupRequired });
    } catch (error) {
      return handleConvexError(error, "Failed to determine setup status");
    }
  })
});

http.route({
  path: "/setup/setup",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const setupRequired = await ctx.runQuery(internal.bridge.getSetupRequired, {});
      if (!setupRequired) {
        return errorJson(409, "CONFLICT", "Admin user already exists");
      }

      await ctx.runMutation(internal.bridge.promoteViewerToAdmin, identity);
      return json({ message: "Admin account configured successfully" });
    } catch (error) {
      return handleConvexError(error, "Failed to complete setup");
    }
  })
});

http.route({
  path: "/users/me",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const profile = await ctx.runQuery(internal.bridge.getViewerProfile, {
        subject: identity.subject
      });
      return json(profile);
    } catch (error) {
      return handleConvexError(error, "Failed to fetch user profile");
    }
  })
});

http.route({
  path: "/users/me",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const body = await parseJsonBody(request);
      const profile = await ctx.runMutation(internal.bridge.updateViewerProfile, {
        subject: identity.subject,
        email: typeof body.email === "string" ? body.email : undefined,
        username: typeof body.username === "string" ? body.username : undefined
      });
      return json(profile);
    } catch (error) {
      return handleConvexError(error, "Failed to update user profile");
    }
  })
});

http.route({
  path: "/users/me/preferences",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const preferences = await ctx.runQuery(internal.bridge.getViewerPreferences, {
        subject: identity.subject
      });
      return json(preferences);
    } catch (error) {
      return handleConvexError(error, "Failed to fetch user preferences");
    }
  })
});

http.route({
  path: "/users/me/preferences",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const body = await parseJsonBody(request);
      const preferences = await ctx.runMutation(internal.bridge.updateViewerPreferences, {
        subject: identity.subject,
        showCardNumbers:
          typeof body.showCardNumbers === "boolean" ? body.showCardNumbers : undefined,
        showPricing: typeof body.showPricing === "boolean" ? body.showPricing : undefined,
        enabledYugioh: typeof body.enabledYugioh === "boolean" ? body.enabledYugioh : undefined,
        enabledMagic: typeof body.enabledMagic === "boolean" ? body.enabledMagic : undefined,
        enabledPokemon:
          typeof body.enabledPokemon === "boolean" ? body.enabledPokemon : undefined,
        defaultGame:
          body.defaultGame === null ||
          body.defaultGame === "yugioh" ||
          body.defaultGame === "magic" ||
          body.defaultGame === "pokemon"
            ? body.defaultGame
            : undefined
      });
      return json(preferences);
    } catch (error) {
      return handleConvexError(error, "Failed to update user preferences");
    }
  })
});

http.route({
  path: "/settings",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = getBridgeIdentity(request);
      if (identity) {
        await ctx.runMutation(internal.bridge.ensureViewer, identity);
      }
      const settings = await ctx.runQuery(internal.bridge.getSettings, {
        subject: identity?.subject
      });
      return json(settings);
    } catch (error) {
      return handleConvexError(error, "Failed to fetch settings");
    }
  })
});

http.route({
  path: "/settings",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      await requireBridgeAdmin(ctx, identity);
      const body = await parseJsonBody(request);
      const settings = await ctx.runMutation(internal.bridge.updateSettings, {
        subject: identity.subject,
        data: {
          publicDashboard:
            typeof body.publicDashboard === "boolean" ? body.publicDashboard : undefined,
          publicCollections:
            typeof body.publicCollections === "boolean" ? body.publicCollections : undefined,
          requireAuth: typeof body.requireAuth === "boolean" ? body.requireAuth : undefined,
          appName: typeof body.appName === "string" ? body.appName : undefined,
          scrydexApiKey:
            typeof body.scrydexApiKey === "string" || body.scrydexApiKey === null
              ? body.scrydexApiKey
              : undefined,
          scrydexTeamId:
            typeof body.scrydexTeamId === "string" || body.scrydexTeamId === null
              ? body.scrydexTeamId
              : undefined,
          scryfallApiBaseUrl:
            typeof body.scryfallApiBaseUrl === "string" || body.scryfallApiBaseUrl === null
              ? body.scryfallApiBaseUrl
              : undefined,
          ygoApiBaseUrl:
            typeof body.ygoApiBaseUrl === "string" || body.ygoApiBaseUrl === null
              ? body.ygoApiBaseUrl
              : undefined,
          scrydexApiBaseUrl:
            typeof body.scrydexApiBaseUrl === "string" || body.scrydexApiBaseUrl === null
              ? body.scrydexApiBaseUrl
              : undefined,
          tcgdexApiBaseUrl:
            typeof body.tcgdexApiBaseUrl === "string" || body.tcgdexApiBaseUrl === null
              ? body.tcgdexApiBaseUrl
              : undefined
        }
      });
      return json(settings);
    } catch (error) {
      return handleConvexError(error, "Failed to update settings");
    }
  })
});

http.route({
  path: "/settings/source-defaults",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      await requireBridgeAdmin(ctx, identity);
      return json({
        scryfall: { url: process.env.SCRYFALL_API_BASE_URL, label: "Scryfall (Magic)" },
        yugioh: { url: process.env.YGO_API_BASE_URL, label: "YGOPRODeck (Yu-Gi-Oh)" },
        pokemon: { url: process.env.POKEMON_API_BASE_URL, label: "Scrydex (Pokémon)" },
        tcgdex: { url: process.env.TCGDEX_API_BASE_URL, label: "TCGdex (Pokémon Variants)" }
      });
    } catch (error) {
      return handleConvexError(error, "Failed to fetch source defaults");
    }
  })
});

http.route({
  path: "/settings/test-source",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      await requireBridgeAdmin(ctx, identity);
      const body = await parseJsonBody(request);
      const source = typeof body.source === "string" ? body.source : "";
      if (!["scryfall", "yugioh", "pokemon", "tcgdex"].includes(source)) {
        return errorJson(400, "BAD_REQUEST", "Unsupported source");
      }

      const settings = await ctx.runQuery(internal.bridge.getSettings, {
        subject: identity.subject
      });
      const adminSettings = settings as Record<string, string | boolean | number | null>;

      const baseUrls: Record<string, string> = {
        scryfall:
          typeof adminSettings.scryfallApiBaseUrl === "string"
            ? adminSettings.scryfallApiBaseUrl
            : (process.env.SCRYFALL_API_BASE_URL ?? "https://api.scryfall.com"),
        yugioh:
          typeof adminSettings.ygoApiBaseUrl === "string"
            ? adminSettings.ygoApiBaseUrl
            : (process.env.YGO_API_BASE_URL ?? "https://db.ygoprodeck.com/api/v7"),
        pokemon:
          typeof adminSettings.scrydexApiBaseUrl === "string"
            ? adminSettings.scrydexApiBaseUrl
            : (process.env.POKEMON_API_BASE_URL ?? "https://api.scrydex.com"),
        tcgdex:
          typeof adminSettings.tcgdexApiBaseUrl === "string"
            ? adminSettings.tcgdexApiBaseUrl
            : (process.env.TCGDEX_API_BASE_URL ?? "https://api.tcgdex.net/v2/en")
      };

      const base = baseUrls[source].replace(/\/+$/, "");
      const isLocal = /localhost|:\d{4}|scryfall-bulk|ygo-cache|tcgdex-cache|pokemon-cache/i.test(
        base
      );

      let url: string;
      if (isLocal) {
        url = `${base}/health`;
      } else {
        switch (source) {
          case "scryfall":
            url = `${base}/cards/named?exact=Lightning+Bolt`;
            break;
          case "yugioh":
            url = `${base}/cardinfo.php?fname=Dark+Magician&num=1`;
            break;
          case "pokemon":
            url = base.includes("scrydex")
              ? `${base}/pokemon/v1/cards?q=name:pikachu&pageSize=1`
              : `${base}/cards?q=name:pikachu&pageSize=1`;
            break;
          default:
            url = `${base}/cards?q=pikachu&pageSize=1`;
            break;
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const start = Date.now();

      try {
        const response = await fetch(url, { signal: controller.signal });
        const latencyMs = Date.now() - start;
        return json(
          response.ok
            ? { ok: true, latencyMs }
            : { ok: false, latencyMs, error: `HTTP ${response.status}` }
        );
      } catch (error) {
        const latencyMs = Date.now() - start;
        const raw = error instanceof Error ? error.message : "Unknown error";
        const message =
          raw === "fetch failed" || raw.includes("ENOTFOUND") || raw.includes("ECONNREFUSED")
            ? `Service unreachable (${new URL(url).hostname})`
            : raw.includes("abort")
              ? "Timeout (5s)"
              : raw;
        return json({ ok: false, latencyMs, error: message });
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      return handleConvexError(error, "Failed to test source");
    }
  })
});

http.route({
  path: "/wishlists",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const wishlists = (await ctx.runQuery(internal.bridge.listWishlists, {
        subject: identity.subject
      })) as NativeWishlist[];
      return json(wishlists);
    } catch (error) {
      return handleConvexError(error, "Failed to fetch wishlists");
    }
  })
});

http.route({
  path: "/wishlists",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const body = await parseJsonBody(request);
      const wishlist = (await ctx.runMutation(internal.bridge.createWishlist, {
        subject: identity.subject,
        name: typeof body.name === "string" ? body.name : "",
        description: typeof body.description === "string" ? body.description : undefined,
        colorHex: typeof body.colorHex === "string" ? body.colorHex : undefined
      })) as NativeWishlist;
      return json(wishlist, 201);
    } catch (error) {
      return handleConvexError(error, "Failed to create wishlist");
    }
  })
});

http.route({
  pathPrefix: "/wishlists/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const url = new URL(request.url);
      const segments = url.pathname.replace(/^\/wishlists\//, "").split("/").filter(Boolean);

      if (segments.length !== 1) {
        return errorJson(404, "NOT_FOUND", "Route not found");
      }

      const wishlist = (await ctx.runQuery(internal.bridge.getWishlist, {
        subject: identity.subject,
        wishlistId: asWishlistId(segments[0])
      })) as NativeWishlist;
      return json(wishlist);
    } catch (error) {
      return handleConvexError(error, "Failed to fetch wishlist");
    }
  })
});

http.route({
  pathPrefix: "/wishlists/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const url = new URL(request.url);
      const segments = url.pathname.replace(/^\/wishlists\//, "").split("/").filter(Boolean);
      const body = await parseJsonBody(request);

      if (segments.length === 2 && segments[1] === "cards") {
        const card = await ctx.runMutation(internal.bridge.addWishlistCard, {
          subject: identity.subject,
          wishlistId: asWishlistId(segments[0]),
          card: body
        });
        return json(card, 201);
      }

      if (segments.length === 3 && segments[1] === "cards" && segments[2] === "batch") {
        const wishlist = await ctx.runMutation(internal.bridge.addWishlistCards, {
          subject: identity.subject,
          wishlistId: asWishlistId(segments[0]),
          cards: Array.isArray(body.cards) ? body.cards : []
        });
        return json(wishlist, 201);
      }

      return errorJson(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      return handleConvexError(error, "Failed to create wishlist resource");
    }
  })
});

http.route({
  pathPrefix: "/wishlists/",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const url = new URL(request.url);
      const segments = url.pathname.replace(/^\/wishlists\//, "").split("/").filter(Boolean);
      const body = await parseJsonBody(request);

      if (segments.length !== 1) {
        return errorJson(404, "NOT_FOUND", "Route not found");
      }

      const wishlist = await ctx.runMutation(internal.bridge.updateWishlist, {
        subject: identity.subject,
        wishlistId: asWishlistId(segments[0]),
        name: typeof body.name === "string" ? body.name : undefined,
        description:
          typeof body.description === "string" || body.description === null
            ? body.description
            : undefined,
        colorHex:
          typeof body.colorHex === "string" || body.colorHex === null ? body.colorHex : undefined
      });
      return json(wishlist);
    } catch (error) {
      return handleConvexError(error, "Failed to update wishlist");
    }
  })
});

http.route({
  pathPrefix: "/wishlists/",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const url = new URL(request.url);
      const segments = url.pathname.replace(/^\/wishlists\//, "").split("/").filter(Boolean);

      if (segments.length === 1) {
        await ctx.runMutation(internal.bridge.deleteWishlist, {
          subject: identity.subject,
          wishlistId: asWishlistId(segments[0])
        });
        return noContent();
      }

      if (segments.length === 3 && segments[1] === "cards") {
        await ctx.runMutation(internal.bridge.removeWishlistCard, {
          subject: identity.subject,
          wishlistId: asWishlistId(segments[0]),
          cardId: asWishlistCardId(segments[2])
        });
        return noContent();
      }

      return errorJson(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      return handleConvexError(error, "Failed to delete wishlist resource");
    }
  })
});

http.route({
  path: "/collections",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const binders = (await ctx.runQuery(internal.bridge.listBinders, {
        subject: identity.subject
      })) as NativeBinderDetail[];
      return json(binders.map((binder) => toLegacyBinder(binder)));
    } catch (error) {
      return handleConvexError(error, "Failed to fetch collections");
    }
  })
});

http.route({
  path: "/collections",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const body = await parseJsonBody(request);
      const binder = (await ctx.runMutation(internal.bridge.createBinder, {
        subject: identity.subject,
        name: typeof body.name === "string" ? body.name : "",
        description: typeof body.description === "string" ? body.description : undefined,
        colorHex: typeof body.colorHex === "string" ? body.colorHex : undefined
      })) as NativeBinderDetail;
      return json(toLegacyBinder(binder), 201);
    } catch (error) {
      return handleConvexError(error, "Failed to create binder");
    }
  })
});

http.route({
  path: "/collections/export",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const format = new URL(request.url).searchParams.get("format") ?? "json";
      const binders = (await ctx.runQuery(internal.bridge.listBinders, {
        subject: identity.subject
      })) as NativeBinderDetail[];
      const rows = toExportRows(binders);

      if (format === "csv") {
        return textResponse(toCsv(rows), 200, {
          "Content-Type": "text/csv",
          "Content-Disposition": 'attachment; filename="collection-export.csv"'
        });
      }

      return json(rows, 200, {
        "Content-Disposition": 'attachment; filename="collection-export.json"'
      });
    } catch (error) {
      return handleConvexError(error, "Failed to export collection");
    }
  })
});

http.route({
  path: "/collections/tags",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const tags = (await ctx.runQuery(internal.bridge.listTags, {
        subject: identity.subject
      })) as NativeTag[];
      return json(tags);
    } catch (error) {
      return handleConvexError(error, "Failed to fetch tags");
    }
  })
});

http.route({
  path: "/collections/tags",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const body = await parseJsonBody(request);
      const tag = await ctx.runMutation(internal.bridge.createTag, {
        subject: identity.subject,
        label: typeof body.label === "string" ? body.label : "",
        colorHex: typeof body.colorHex === "string" ? body.colorHex : undefined
      });
      return json(tag, 201);
    } catch (error) {
      return handleConvexError(error, "Failed to create tag");
    }
  })
});

http.route({
  path: "/collections/cards",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const body = await parseJsonBody(request);
      const libraryBinderId = await ctx.runQuery(internal.bridge.libraryBinderId, {
        subject: identity.subject
      });
      const entry = await ctx.runMutation(internal.bridge.addCardToBinder, {
        subject: identity.subject,
        binderId: libraryBinderId,
        cardId: typeof body.cardId === "string" ? body.cardId : undefined,
        quantity: typeof body.quantity === "number" ? body.quantity : undefined,
        condition: typeof body.condition === "string" ? body.condition : undefined,
        language: typeof body.language === "string" ? body.language : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
        price: typeof body.price === "number" ? body.price : undefined,
        acquisitionPrice:
          typeof body.acquisitionPrice === "number" ? body.acquisitionPrice : undefined,
        serialNumber: typeof body.serialNumber === "string" ? body.serialNumber : undefined,
        acquiredAt: typeof body.acquiredAt === "string" ? body.acquiredAt : undefined,
        isFoil: typeof body.isFoil === "boolean" ? body.isFoil : undefined,
        isSigned: typeof body.isSigned === "boolean" ? body.isSigned : undefined,
        isAltered: typeof body.isAltered === "boolean" ? body.isAltered : undefined,
        tagIds: Array.isArray(body.tags) ? body.tags : undefined,
        newTags: Array.isArray(body.newTags) ? body.newTags : undefined,
        cardData: body.cardData
      });
      const binder = (await ctx.runQuery(internal.bridge.getBinder, {
        subject: identity.subject,
        binderId: libraryBinderId
      })) as NativeBinderDetail;
      const legacyBinder = toLegacyBinder(binder);
      return json(findLegacyCardByCopyId(legacyBinder, entry.id) ?? legacyBinder.cards[0], 201);
    } catch (error) {
      return handleConvexError(error, "Failed to add card");
    }
  })
});

http.route({
  pathPrefix: "/collections/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const url = new URL(request.url);
      const segments = url.pathname.replace(/^\/collections\//, "").split("/").filter(Boolean);
      if (segments.length !== 1 || segments[0] === "tags" || segments[0] === "export") {
        return errorJson(404, "NOT_FOUND", "Route not found");
      }
      const binderId = await resolveActualBinderId(ctx, identity, segments[0]);
      const binder = (await ctx.runQuery(internal.bridge.getBinder, {
        subject: identity.subject,
        binderId
      })) as NativeBinderDetail;
      return json(toLegacyBinder(binder));
    } catch (error) {
      return handleConvexError(error, "Failed to fetch binder");
    }
  })
});

http.route({
  pathPrefix: "/collections/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const url = new URL(request.url);
      const segments = url.pathname.replace(/^\/collections\//, "").split("/").filter(Boolean);

      if (segments.length === 2 && segments[1] === "cards") {
        const binderId = await resolveActualBinderId(ctx, identity, segments[0]);
        const body = await parseJsonBody(request);
        const entry = await ctx.runMutation(internal.bridge.addCardToBinder, {
          subject: identity.subject,
          binderId,
          cardId: typeof body.cardId === "string" ? body.cardId : undefined,
          quantity: typeof body.quantity === "number" ? body.quantity : undefined,
          condition: typeof body.condition === "string" ? body.condition : undefined,
          language: typeof body.language === "string" ? body.language : undefined,
          notes: typeof body.notes === "string" ? body.notes : undefined,
          price: typeof body.price === "number" ? body.price : undefined,
          acquisitionPrice:
            typeof body.acquisitionPrice === "number" ? body.acquisitionPrice : undefined,
          serialNumber: typeof body.serialNumber === "string" ? body.serialNumber : undefined,
          acquiredAt: typeof body.acquiredAt === "string" ? body.acquiredAt : undefined,
          isFoil: typeof body.isFoil === "boolean" ? body.isFoil : undefined,
          isSigned: typeof body.isSigned === "boolean" ? body.isSigned : undefined,
          isAltered: typeof body.isAltered === "boolean" ? body.isAltered : undefined,
          tagIds: Array.isArray(body.tags) ? body.tags : undefined,
          newTags: Array.isArray(body.newTags) ? body.newTags : undefined,
          cardData: body.cardData
        });
        const binder = (await ctx.runQuery(internal.bridge.getBinder, {
          subject: identity.subject,
          binderId
        })) as NativeBinderDetail;
        const legacyBinder = toLegacyBinder(binder);
        return json(findLegacyCardByCopyId(legacyBinder, entry.id) ?? legacyBinder.cards[0], 201);
      }

      if (segments.length === 4 && segments[1] === "cards" && segments[3] === "images") {
        const form = await request.formData();
        const files = form.getAll("images").filter((value): value is File => value instanceof File);
        if (!files.length) {
          return errorJson(400, "BAD_REQUEST", "No images provided");
        }

        let imageUrls: string[] = [];
        for (const file of files) {
          const storageId = await ctx.storage.store(file);
          const imageUrl = await ctx.storage.getUrl(storageId);
          if (!imageUrl) {
            throw new ConvexError({
              code: "INVARIANT",
              message: "Failed to resolve uploaded image URL"
            });
          }
          const result = await ctx.runMutation(internal.bridge.attachImageToEntry, {
            subject: identity.subject,
            entryId: asCollectionEntryId(segments[2]),
            imageUrl,
            storageId
          });
          imageUrls = result.imageUrls;
        }

        return json({ imageUrls }, 201);
      }

      return errorJson(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      return handleConvexError(error, "Failed to create resource");
    }
  })
});

http.route({
  pathPrefix: "/collections/",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const url = new URL(request.url);
      const segments = url.pathname.replace(/^\/collections\//, "").split("/").filter(Boolean);
      const body = await parseJsonBody(request);

      if (segments.length === 1) {
        const binderId = await resolveActualBinderId(ctx, identity, segments[0]);
        const binder = (await ctx.runMutation(internal.bridge.updateBinder, {
          subject: identity.subject,
          binderId,
          name: typeof body.name === "string" ? body.name : undefined,
          description: typeof body.description === "string" ? body.description : undefined,
          colorHex: typeof body.colorHex === "string" ? body.colorHex : undefined
        })) as NativeBinderDetail;
        return json(toLegacyBinder(binder));
      }

      if (segments.length === 3 && segments[1] === "cards") {
        const targetBinderId =
          typeof body.targetBinderId === "string"
            ? await resolveActualBinderId(ctx, identity, body.targetBinderId)
            : undefined;
        const updated = await ctx.runMutation(internal.bridge.updateEntry, {
          subject: identity.subject,
          entryId: asCollectionEntryId(segments[2]),
          binderId: targetBinderId,
          quantity: typeof body.quantity === "number" ? body.quantity : undefined,
          condition:
            typeof body.condition === "string" || body.condition === null
              ? body.condition
              : undefined,
          language:
            typeof body.language === "string" || body.language === null
              ? body.language
              : undefined,
          notes:
            typeof body.notes === "string" || body.notes === null ? body.notes : undefined,
          price: typeof body.price === "number" ? body.price : undefined,
          acquisitionPrice:
            typeof body.acquisitionPrice === "number" ? body.acquisitionPrice : undefined,
          serialNumber:
            typeof body.serialNumber === "string" || body.serialNumber === null
              ? body.serialNumber
              : undefined,
          acquiredAt:
            typeof body.acquiredAt === "string" || body.acquiredAt === null
              ? body.acquiredAt
              : undefined,
          isFoil: typeof body.isFoil === "boolean" ? body.isFoil : undefined,
          isSigned: typeof body.isSigned === "boolean" ? body.isSigned : undefined,
          isAltered: typeof body.isAltered === "boolean" ? body.isAltered : undefined,
          tagIds: Array.isArray(body.tags) ? body.tags : undefined,
          newTags: Array.isArray(body.newTags) ? body.newTags : undefined,
          cardOverride:
            body.cardOverride && typeof body.cardOverride === "object"
              ? {
                  cardId:
                    typeof body.cardOverride.cardId === "string"
                      ? body.cardOverride.cardId
                      : "",
                  cardData: body.cardOverride.cardData
                }
              : undefined
        });
        const binder = (await ctx.runQuery(internal.bridge.getBinder, {
          subject: identity.subject,
          binderId: updated.binderId
        })) as NativeBinderDetail;
        const legacyBinder = toLegacyBinder(binder);
        return json(findLegacyCardByCopyId(legacyBinder, updated.id) ?? legacyBinder.cards[0]);
      }

      return errorJson(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      return handleConvexError(error, "Failed to update collection");
    }
  })
});

http.route({
  pathPrefix: "/collections/",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireBridgeIdentity(ctx, request);
      const url = new URL(request.url);
      const segments = url.pathname.replace(/^\/collections\//, "").split("/").filter(Boolean);

      if (segments.length === 1) {
        const binderId = await resolveActualBinderId(ctx, identity, segments[0]);
        await ctx.runMutation(internal.bridge.deleteBinder, {
          subject: identity.subject,
          binderId
        });
        return noContent();
      }

      if (segments.length === 3 && segments[1] === "cards") {
        await ctx.runMutation(internal.bridge.removeEntry, {
          subject: identity.subject,
          entryId: asCollectionEntryId(segments[2])
        });
        return noContent();
      }

      if (segments.length === 5 && segments[1] === "cards" && segments[3] === "images") {
        const imageIndex = Number.parseInt(segments[4] ?? "", 10);
        if (!Number.isInteger(imageIndex)) {
          return errorJson(400, "BAD_REQUEST", "Image index must be an integer");
        }
        const result = await ctx.runMutation(internal.bridge.removeImageFromEntry, {
          subject: identity.subject,
          entryId: asCollectionEntryId(segments[2]),
          imageIndex
        });
        if (result.removedStorageId) {
          await ctx.storage.delete(result.removedStorageId);
        }
        return noContent();
      }

      return errorJson(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      return handleConvexError(error, "Failed to delete resource");
    }
  })
});

export default http;
