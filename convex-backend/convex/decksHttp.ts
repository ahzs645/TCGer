import type { HttpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import {
  errorJson,
  handleConvexError,
  json,
  parseJsonBody,
  requireBridgeIdentity,
} from "./lib/httpBridge";

type TcgCode =
  | "yugioh"
  | "magic"
  | "pokemon"
  | "onepiece"
  | "lorcana"
  | "dragonball";
type DeckZone = "main" | "extra" | "side";

type ImportedCard = {
  externalId: string;
  tcg: string;
  name: string;
  quantity: number;
  zone?: DeckZone;
  isSideboard?: boolean;
  imageUrl?: string;
  imageUrlSmall?: string;
  setCode?: string;
  setName?: string;
  cardData?: Record<string, unknown>;
};

const deckFunctions = internal.decks;
const TCG_CODES: readonly TcgCode[] = [
  "yugioh",
  "magic",
  "pokemon",
  "onepiece",
  "lorcana",
  "dragonball",
];
const IMPORT_SOURCES = [
  "text",
  "moxfield",
  "archidekt",
  "mtggoldfish",
  "arena",
  "ygoprodeck",
  "ydk",
] as const;

function isTcgCode(value: unknown): value is TcgCode {
  return typeof value === "string" && TCG_CODES.includes(value as TcgCode);
}

function isDeckZone(value: unknown): value is DeckZone {
  return value === "main" || value === "extra" || value === "side";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(body: Record<string, unknown>, field: string) {
  return body[field] === undefined || typeof body[field] === "string";
}

function invalidPayload(message = "Payload validation failed") {
  return errorJson(400, "VALIDATION_ERROR", message);
}

function handleDeckError(error: unknown, fallback: string) {
  if (error instanceof ConvexError && typeof error.data === "string") {
    try {
      return handleConvexError(
        new ConvexError(JSON.parse(error.data)),
        fallback,
      );
    } catch {
      // Fall through to the shared handler with the original error.
    }
  }
  return handleConvexError(error, fallback);
}

function asDeckId(value: string) {
  return value as any;
}

function asDeckCardId(value: string) {
  return value as any;
}

function routeSegments(request: Request) {
  return new URL(request.url).pathname
    .replace(/^\/decks\//, "")
    .split("/")
    .filter(Boolean);
}

function parseTextDeckList(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const entries: Array<{
    name: string;
    quantity: number;
    isSideboard: boolean;
    setCode?: string;
  }> = [];
  let isSideboard = false;

  for (const line of lines) {
    if (/^(sideboard|side|sb):?\s*$/i.test(line)) {
      isSideboard = true;
      continue;
    }
    if (/^(main|maindeck|main deck|deck):?\s*$/i.test(line)) {
      isSideboard = false;
      continue;
    }
    if (line.startsWith("//") || line.startsWith("#")) continue;

    let match = line.match(/^(\d+)\s*x?\s+(.+?)(?:\s+\((\w+)\)(?:\s+\d+)?)?$/i);
    if (match) {
      entries.push({
        quantity: Number.parseInt(match[1]!, 10),
        name: match[2]!.trim(),
        setCode: match[3],
        isSideboard,
      });
      continue;
    }
    match = line.match(/^(.+?)\s+x(\d+)$/i);
    if (match) {
      entries.push({
        quantity: Number.parseInt(match[2]!, 10),
        name: match[1]!.trim(),
        isSideboard,
      });
      continue;
    }
    if (line.length > 0 && !line.startsWith("---")) {
      entries.push({ name: line, quantity: 1, isSideboard });
    }
  }
  return entries;
}

function parseYdk(content: string) {
  const cards = new Map<string, ImportedCard>();
  let zone: DeckZone = "main";
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#created")) continue;
    if (line === "#main") {
      zone = "main";
      continue;
    }
    if (line === "#extra") {
      zone = "extra";
      continue;
    }
    if (line === "!side") {
      zone = "side";
      continue;
    }
    if (line.startsWith("#") || !/^\d{8}$/.test(line)) continue;
    const key = `${zone}:${line}`;
    const existing = cards.get(key);
    if (existing) existing.quantity += 1;
    else {
      cards.set(key, {
        externalId: line,
        tcg: "yugioh",
        name: line,
        quantity: 1,
        zone,
      });
    }
  }
  return Array.from(cards.values());
}

function extractIdFromUrl(input: string, domain: string) {
  try {
    const url = new URL(input.startsWith("http") ? input : `https://${input}`);
    if (!url.hostname.includes(domain)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.at(-1) ?? null;
  } catch {
    return null;
  }
}

async function resolveYdkCard(card: ImportedCard): Promise<ImportedCard> {
  const root = (
    process.env.YGO_API_BASE_URL ?? "https://db.ygoprodeck.com/api/v7"
  ).replace(/\/+$/, "");
  try {
    const url = new URL(`${root}/cardinfo.php`);
    url.searchParams.set("id", card.externalId);
    const response = await fetch(url);
    if (!response.ok) return card;
    const payload = (await response.json()) as {
      data?: Array<Record<string, any>>;
    };
    const resolved = payload.data?.[0];
    if (!resolved) return card;
    const image = Array.isArray(resolved.card_images)
      ? resolved.card_images[0]
      : undefined;
    const set = Array.isArray(resolved.card_sets)
      ? resolved.card_sets[0]
      : undefined;
    return {
      ...card,
      externalId: String(resolved.id ?? card.externalId),
      name: typeof resolved.name === "string" ? resolved.name : card.name,
      imageUrl:
        typeof image?.image_url === "string" ? image.image_url : undefined,
      imageUrlSmall:
        typeof image?.image_url_small === "string"
          ? image.image_url_small
          : undefined,
      setCode: typeof set?.set_code === "string" ? set.set_code : undefined,
      setName: typeof set?.set_name === "string" ? set.set_name : undefined,
      cardData: {
        ...resolved,
        cardType: resolved.type,
        baseExternalId: String(resolved.id ?? card.externalId),
      },
    };
  } catch {
    return card;
  }
}

async function parseImportSource(body: Record<string, any>) {
  const tcg: TcgCode = isTcgCode(body.tcg) ? body.tcg : "magic";
  if (body.source === "ydk") {
    const parsed = parseYdk(body.data);
    const cards: ImportedCard[] = [];
    for (const card of parsed) cards.push(await resolveYdkCard(card));
    return {
      cards,
      name: body.name || "Imported YDK Deck",
      tcg: "yugioh" as const,
    };
  }

  let parsed = parseTextDeckList(body.data);
  let fetchedName: string | undefined;
  if (body.source === "moxfield") {
    const deckId = extractIdFromUrl(body.data, "moxfield.com");
    if (deckId) {
      try {
        const response = await fetch(
          `https://api2.moxfield.com/v3/decks/all/${deckId}`,
        );
        if (!response.ok) throw new Error("Moxfield API error");
        const data = (await response.json()) as any;
        parsed = [];
        for (const entry of Object.values(data.mainboard ?? {}) as any[]) {
          parsed.push({
            name: entry.card?.name ?? "",
            quantity: entry.quantity ?? 1,
            isSideboard: false,
          });
        }
        for (const entry of Object.values(data.sideboard ?? {}) as any[]) {
          parsed.push({
            name: entry.card?.name ?? "",
            quantity: entry.quantity ?? 1,
            isSideboard: true,
          });
        }
        fetchedName = typeof data.name === "string" ? data.name : undefined;
      } catch {
        parsed = parseTextDeckList(body.data);
      }
    }
  } else if (body.source === "archidekt") {
    const deckId = extractIdFromUrl(body.data, "archidekt.com");
    if (deckId) {
      try {
        const response = await fetch(
          `https://archidekt.com/api/decks/${deckId}/`,
        );
        if (!response.ok) throw new Error("Archidekt API error");
        const data = (await response.json()) as any;
        parsed = (data.cards ?? []).map((entry: any) => ({
          name: entry.card?.oracleCard?.name ?? entry.card?.name ?? "",
          quantity: entry.quantity ?? 1,
          isSideboard: entry.categories?.includes("Sideboard") ?? false,
        }));
        fetchedName = typeof data.name === "string" ? data.name : undefined;
      } catch {
        parsed = parseTextDeckList(body.data);
      }
    }
  }

  return {
    cards: parsed.map((card) => ({
      externalId: card.name.toLowerCase().replace(/\s+/g, "-"),
      tcg,
      name: card.name,
      quantity: card.quantity,
      isSideboard: card.isSideboard,
      setCode: card.setCode,
    })),
    name: fetchedName || body.name || "Imported Deck",
    tcg,
  };
}

type CreateDeckPayload = {
  name: string;
  description?: string;
  tcg: TcgCode;
  format?: string;
  colorHex?: string;
  isPublic?: boolean;
};

type AddCardPayload = {
  externalId: string;
  tcg: string;
  name: string;
  quantity?: number;
  zone?: DeckZone;
  isCommander?: boolean;
  isSideboard?: boolean;
  imageUrl?: string;
  imageUrlSmall?: string;
  setCode?: string;
  setName?: string;
  cardData?: Record<string, unknown>;
};

type ClassicalBanlist = {
  type: "classical";
  name: string;
  effectiveDate?: string;
  cards: Record<string, string>;
};

type GenesysBanlist = {
  type: "genesys";
  name: string;
  effectiveDate?: string;
  cards: Record<string, number>;
  maxPoints: number;
};

function isValidCreateDeck(
  body: Record<string, unknown>
): body is Record<string, unknown> & CreateDeckPayload {
  return (
    typeof body.name === "string" &&
    body.name.length >= 1 &&
    isTcgCode(body.tcg) &&
    isOptionalString(body, "description") &&
    isOptionalString(body, "format") &&
    isOptionalString(body, "colorHex") &&
    (body.isPublic === undefined || typeof body.isPublic === "boolean")
  );
}

function isValidAddCard(
  body: Record<string, unknown>
): body is Record<string, unknown> & AddCardPayload {
  return (
    typeof body.externalId === "string" &&
    body.externalId.length >= 1 &&
    typeof body.tcg === "string" &&
    body.tcg.length >= 1 &&
    typeof body.name === "string" &&
    body.name.length >= 1 &&
    (body.quantity === undefined ||
      (typeof body.quantity === "number" &&
        Number.isInteger(body.quantity) &&
        body.quantity > 0)) &&
    (body.zone === undefined || isDeckZone(body.zone)) &&
    (body.isCommander === undefined || typeof body.isCommander === "boolean") &&
    (body.isSideboard === undefined || typeof body.isSideboard === "boolean") &&
    isOptionalString(body, "imageUrl") &&
    isOptionalString(body, "imageUrlSmall") &&
    isOptionalString(body, "setCode") &&
    isOptionalString(body, "setName") &&
    (body.cardData === undefined || isRecord(body.cardData))
  );
}

function parseBanlist(value: unknown): ClassicalBanlist | GenesysBanlist | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    value.name.length < 1
  )
    return null;
  if (
    value.effectiveDate !== undefined &&
    typeof value.effectiveDate !== "string"
  )
    return null;
  if (!isRecord(value.cards)) return null;
  if (value.type === "classical") {
    if (Object.values(value.cards).some((entry) => typeof entry !== "string"))
      return null;
    return value as ClassicalBanlist;
  }
  if (value.type === "genesys") {
    if (
      typeof value.maxPoints !== "number" ||
      value.maxPoints < 0 ||
      Object.values(value.cards).some((entry) => typeof entry !== "number")
    ) {
      return null;
    }
    return value as GenesysBanlist;
  }
  return null;
}

export function registerDecksRoutes(http: HttpRouter) {
  http.route({
    path: "/decks",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        return json(
          await ctx.runQuery(deckFunctions.list, { subject: identity.subject }),
        );
      } catch (error) {
        return handleDeckError(error, "Failed to fetch decks");
      }
    }),
  });

  http.route({
    path: "/decks",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const body = await parseJsonBody(request);
        if (!isRecord(body) || !isValidCreateDeck(body))
          return invalidPayload();
        const deck = await ctx.runMutation(deckFunctions.create, {
          subject: identity.subject,
          name: body.name,
          description: body.description,
          tcg: body.tcg,
          format: body.format,
          colorHex: body.colorHex,
          isPublic: body.isPublic,
        });
        return json(deck, 201);
      } catch (error) {
        return handleDeckError(error, "Failed to create deck");
      }
    }),
  });

  http.route({
    path: "/decks/import",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const body = await parseJsonBody(request);
        if (
          !isRecord(body) ||
          !IMPORT_SOURCES.includes(body.source as any) ||
          typeof body.data !== "string" ||
          body.data.length < 1 ||
          !isOptionalString(body, "name") ||
          (body.tcg !== undefined && !isTcgCode(body.tcg)) ||
          !isOptionalString(body, "format")
        ) {
          return invalidPayload();
        }
        const imported = await parseImportSource(body);
        const deck = await ctx.runMutation(deckFunctions.create, {
          subject: identity.subject,
          name: imported.name,
          tcg: imported.tcg,
          format: body.format as string | undefined,
        });
        let importedCount = 0;
        const skippedCards: string[] = [];
        for (const card of imported.cards) {
          try {
            await ctx.runMutation(deckFunctions.addCard, {
              subject: identity.subject,
              deckId: asDeckId(deck.id),
              ...card,
            });
            importedCount += 1;
          } catch {
            skippedCards.push(
              body.source === "ydk" ? card.externalId : card.name,
            );
          }
        }
        const hydrated = await ctx.runQuery(deckFunctions.get, {
          subject: identity.subject,
          deckId: asDeckId(deck.id),
        });
        return json(
          {
            deck: hydrated,
            importedCount,
            skippedCount: skippedCards.length,
            skippedCards,
          },
          201,
        );
      } catch (error) {
        return handleDeckError(error, "Failed to import deck");
      }
    }),
  });

  http.route({
    pathPrefix: "/decks/",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const segments = routeSegments(request);
        if (segments.length === 1) {
          return json(
            await ctx.runQuery(deckFunctions.get, {
              subject: identity.subject,
              deckId: asDeckId(segments[0]!),
            }),
          );
        }
        if (segments.length === 2 && segments[1] === "analysis") {
          return json(
            await ctx.runQuery(deckFunctions.analyze, {
              subject: identity.subject,
              deckId: asDeckId(segments[0]!),
            }),
          );
        }
        if (segments.length === 2 && segments[1] === "ownership") {
          return json(
            await ctx.runQuery(deckFunctions.ownership, {
              subject: identity.subject,
              deckId: asDeckId(segments[0]!),
            }),
          );
        }
        if (segments.length === 2 && segments[1] === "ydk") {
          return json(
            await ctx.runQuery(deckFunctions.exportYdk, {
              subject: identity.subject,
              deckId: asDeckId(segments[0]!),
            }),
          );
        }
        return errorJson(404, "NOT_FOUND", "Route not found");
      } catch (error) {
        return handleDeckError(error, "Failed to fetch deck resource");
      }
    }),
  });

  http.route({
    pathPrefix: "/decks/",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const segments = routeSegments(request);
        const body = await parseJsonBody(request);
        if (!isRecord(body)) return invalidPayload();

        if (segments.length === 2 && segments[1] === "cards") {
          if (!isValidAddCard(body)) return invalidPayload();
          const card = await ctx.runMutation(deckFunctions.addCard, {
            subject: identity.subject,
            deckId: asDeckId(segments[0]!),
            externalId: body.externalId,
            tcg: body.tcg,
            name: body.name,
            quantity: body.quantity,
            zone: body.zone,
            isCommander: body.isCommander,
            isSideboard: body.isSideboard,
            imageUrl: body.imageUrl,
            imageUrlSmall: body.imageUrlSmall,
            setCode: body.setCode,
            setName: body.setName,
            cardData: body.cardData,
          });
          return json(card, 201);
        }

        if (segments.length === 2 && segments[1] === "validate") {
          if (!isOptionalString(body, "format")) return invalidPayload();
          const banlist =
            body.banlist === undefined ? undefined : parseBanlist(body.banlist);
          if (body.banlist !== undefined && !banlist) return invalidPayload();
          return json(
            await ctx.runQuery(deckFunctions.validate, {
              subject: identity.subject,
              deckId: asDeckId(segments[0]!),
              format: body.format as string | undefined,
              banlist: banlist ?? undefined,
            }),
          );
        }

        return errorJson(404, "NOT_FOUND", "Route not found");
      } catch (error) {
        return handleDeckError(error, "Failed to create deck resource");
      }
    }),
  });

  http.route({
    pathPrefix: "/decks/",
    method: "PATCH",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const segments = routeSegments(request);
        const body = await parseJsonBody(request);
        if (!isRecord(body)) return invalidPayload();

        if (segments.length === 1) {
          const supported = [
            "name",
            "description",
            "format",
            "colorHex",
            "isPublic",
          ];
          const hasUpdate = supported.some(
            (field) => body[field] !== undefined,
          );
          if (
            !hasUpdate ||
            (body.name !== undefined &&
              (typeof body.name !== "string" || body.name.length < 1)) ||
            !isOptionalString(body, "description") ||
            !isOptionalString(body, "format") ||
            !isOptionalString(body, "colorHex") ||
            (body.isPublic !== undefined && typeof body.isPublic !== "boolean")
          ) {
            return invalidPayload();
          }
          const update = body as {
            name?: string;
            description?: string;
            format?: string;
            colorHex?: string;
            isPublic?: boolean;
          };
          return json(
            await ctx.runMutation(deckFunctions.update, {
              subject: identity.subject,
              deckId: asDeckId(segments[0]!),
              name: update.name,
              description: update.description,
              format: update.format,
              colorHex: update.colorHex,
              isPublic: update.isPublic,
            }),
          );
        }

        if (segments.length === 3 && segments[1] === "cards") {
          const supported = ["quantity", "zone", "isCommander", "isSideboard"];
          const hasUpdate = supported.some(
            (field) => body[field] !== undefined,
          );
          if (
            !hasUpdate ||
            (body.quantity !== undefined &&
              (typeof body.quantity !== "number" ||
                !Number.isInteger(body.quantity) ||
                body.quantity < 1)) ||
            (body.zone !== undefined && !isDeckZone(body.zone)) ||
            (body.isCommander !== undefined &&
              typeof body.isCommander !== "boolean") ||
            (body.isSideboard !== undefined &&
              typeof body.isSideboard !== "boolean")
          ) {
            return invalidPayload();
          }
          return json(
            await ctx.runMutation(deckFunctions.updateCard, {
              subject: identity.subject,
              deckId: asDeckId(segments[0]!),
              cardId: asDeckCardId(segments[2]!),
              quantity: body.quantity,
              zone: body.zone,
              isCommander: body.isCommander,
              isSideboard: body.isSideboard,
            }),
          );
        }

        return errorJson(404, "NOT_FOUND", "Route not found");
      } catch (error) {
        return handleDeckError(error, "Failed to update deck resource");
      }
    }),
  });

  http.route({
    pathPrefix: "/decks/",
    method: "DELETE",
    handler: httpAction(async (ctx, request) => {
      try {
        const identity = await requireBridgeIdentity(ctx, request);
        const segments = routeSegments(request);
        if (segments.length === 1) {
          await ctx.runMutation(deckFunctions.remove, {
            subject: identity.subject,
            deckId: asDeckId(segments[0]!),
          });
          return new Response(null, { status: 204 });
        }
        if (segments.length === 3 && segments[1] === "cards") {
          await ctx.runMutation(deckFunctions.removeCard, {
            subject: identity.subject,
            deckId: asDeckId(segments[0]!),
            cardId: asDeckCardId(segments[2]!),
          });
          return new Response(null, { status: 204 });
        }
        return errorJson(404, "NOT_FOUND", "Route not found");
      } catch (error) {
        return handleDeckError(error, "Failed to delete deck resource");
      }
    }),
  });
}
