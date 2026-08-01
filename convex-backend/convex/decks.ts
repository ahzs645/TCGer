import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

type ReaderCtx = QueryCtx | MutationCtx;
type DeckZone = "main" | "extra" | "side";
type CardData = Record<string, any>;

const tcgCodeValidator = v.union(
  v.literal("yugioh"),
  v.literal("magic"),
  v.literal("pokemon"),
  v.literal("onepiece"),
  v.literal("lorcana"),
  v.literal("dragonball"),
);

const deckZoneValidator = v.union(
  v.literal("main"),
  v.literal("extra"),
  v.literal("side"),
);

const cardDataValidator = v.record(v.string(), v.any());

const deckCardValidator = v.object({
  id: v.string(),
  externalId: v.string(),
  tcg: v.string(),
  name: v.string(),
  quantity: v.number(),
  zone: deckZoneValidator,
  isCommander: v.boolean(),
  isSideboard: v.boolean(),
  imageUrl: v.optional(v.string()),
  imageUrlSmall: v.optional(v.string()),
  setCode: v.optional(v.string()),
  setName: v.optional(v.string()),
  cardData: v.optional(cardDataValidator),
});

const deckValidator = v.object({
  id: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  tcg: v.string(),
  format: v.optional(v.string()),
  colorHex: v.optional(v.string()),
  isPublic: v.boolean(),
  cards: v.array(deckCardValidator),
  cardCount: v.number(),
  createdAt: v.string(),
  updatedAt: v.string(),
});

const analysisValidator = v.object({
  totalCards: v.number(),
  mainDeckCount: v.number(),
  extraDeckCount: v.number(),
  sideboardCount: v.number(),
  manaCurve: v.record(v.string(), v.number()),
  colorDistribution: v.record(v.string(), v.number()),
  typeDistribution: v.record(v.string(), v.number()),
  rarityDistribution: v.record(v.string(), v.number()),
  averageCmc: v.number(),
});

const ownershipValidator = v.object({
  owned: v.array(v.object({ externalId: v.string(), quantity: v.number() })),
  missing: v.array(
    v.object({
      externalId: v.string(),
      name: v.string(),
      quantity: v.number(),
      zone: deckZoneValidator,
    }),
  ),
  missingCount: v.number(),
});

const violationValidator = v.object({
  externalId: v.optional(v.string()),
  name: v.optional(v.string()),
  zone: v.optional(deckZoneValidator),
  message: v.string(),
});

const validationResultValidator = v.object({
  valid: v.boolean(),
  errors: v.array(v.string()),
  warnings: v.array(v.string()),
  format: v.optional(v.string()),
  points: v.optional(v.number()),
  violations: v.optional(v.array(violationValidator)),
});

const banlistValidator = v.union(
  v.object({
    type: v.literal("classical"),
    name: v.string(),
    effectiveDate: v.optional(v.string()),
    cards: v.record(v.string(), v.string()),
  }),
  v.object({
    type: v.literal("genesys"),
    name: v.string(),
    effectiveDate: v.optional(v.string()),
    maxPoints: v.number(),
    cards: v.record(v.string(), v.number()),
  }),
);

async function requireViewerBySubject(ctx: ReaderCtx, subject: string) {
  const viewer = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", subject))
    .unique();
  if (!viewer) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Viewer not provisioned",
    });
  }
  return viewer;
}

async function requireDeckForUser(
  ctx: ReaderCtx,
  deckId: Id<"decks">,
  userId: Id<"users">,
) {
  const deck = await ctx.db.get(deckId);
  if (!deck || deck.userId !== userId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Deck not found",
    });
  }
  return deck;
}

async function requireDeckCard(
  ctx: ReaderCtx,
  deckId: Id<"decks">,
  cardId: Id<"deckCards">,
) {
  const card = await ctx.db.get(cardId);
  if (!card || card.deckId !== deckId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Deck card not found",
    });
  }
  return card;
}

function toCardResponse(card: Doc<"deckCards">) {
  return {
    id: card._id,
    externalId: card.externalId,
    tcg: card.tcg,
    name: card.name,
    quantity: card.quantity,
    zone: card.zone,
    isCommander: card.isCommander,
    isSideboard: card.isSideboard,
    imageUrl: card.imageUrl,
    imageUrlSmall: card.imageUrlSmall,
    setCode: card.setCode,
    setName: card.setName,
    cardData: card.cardData,
  };
}

async function hydrateDeck(ctx: ReaderCtx, deck: Doc<"decks">) {
  const cards = await ctx.db
    .query("deckCards")
    .withIndex("by_deck", (q) => q.eq("deckId", deck._id))
    .take(1000);
  const sortedCards = cards.sort((left, right) => {
    const zoneOrder = left.zone.localeCompare(right.zone);
    return zoneOrder !== 0 ? zoneOrder : left.name.localeCompare(right.name);
  });

  return {
    id: deck._id,
    name: deck.name,
    description: deck.description,
    tcg: deck.tcg,
    format: deck.format,
    colorHex: deck.colorHex,
    isPublic: deck.isPublic,
    cards: sortedCards.map(toCardResponse),
    cardCount: cards.reduce((sum, card) => sum + card.quantity, 0),
    createdAt: new Date(deck.createdAt).toISOString(),
    updatedAt: new Date(deck.updatedAt).toISOString(),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function attributesFrom(cardData?: CardData): CardData | undefined {
  const attributes = cardData?.attributes;
  return attributes &&
    typeof attributes === "object" &&
    !Array.isArray(attributes)
    ? (attributes as CardData)
    : undefined;
}

function resolveYugiohBaseId(card: {
  externalId: string;
  cardData?: CardData;
}) {
  const attributes = attributesFrom(card.cardData);
  return (
    stringValue(card.cardData?.baseId) ??
    stringValue(card.cardData?.baseExternalId) ??
    stringValue(card.cardData?.identityExternalId) ??
    stringValue(attributes?.baseId) ??
    card.externalId
  );
}

function inferYugiohZone(card: {
  zone?: DeckZone;
  isSideboard?: boolean;
  cardData?: CardData;
}): DeckZone {
  if (card.zone) {
    return card.zone;
  }
  if (card.isSideboard) {
    return "side";
  }

  const attributes = attributesFrom(card.cardData);
  const type = (
    stringValue(card.cardData?.cardType) ??
    stringValue(card.cardData?.type) ??
    stringValue(attributes?.cardType) ??
    stringValue(attributes?.type) ??
    ""
  ).toLowerCase();

  return ["fusion", "synchro", "xyz", "link"].some((extraType) =>
    type.includes(extraType),
  )
    ? "extra"
    : "main";
}

function positiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value < 1) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${field} must be a positive integer`,
    });
  }
  return value;
}

async function assertUniqueDeckName(
  ctx: ReaderCtx,
  userId: Id<"users">,
  name: string,
  excludingDeckId?: Id<"decks">,
) {
  const existing = await ctx.db
    .query("decks")
    .withIndex("by_user_and_name", (q) =>
      q.eq("userId", userId).eq("name", name),
    )
    .unique();
  if (existing && existing._id !== excludingDeckId) {
    throw new ConvexError({
      code: "CONFLICT",
      message: "A deck with this name already exists",
    });
  }
}

export const list = internalQuery({
  args: { subject: v.string() },
  returns: v.array(deckValidator),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const decks = await ctx.db
      .query("decks")
      .withIndex("by_user", (q) => q.eq("userId", viewer._id))
      .order("desc")
      .take(1000);
    const hydrated = await Promise.all(
      decks.map((deck) => hydrateDeck(ctx, deck)),
    );
    return hydrated.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  },
});

export const get = internalQuery({
  args: {
    subject: v.string(),
    deckId: v.id("decks"),
  },
  returns: deckValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const deck = await requireDeckForUser(ctx, args.deckId, viewer._id);
    return await hydrateDeck(ctx, deck);
  },
});

export const create = internalMutation({
  args: {
    subject: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    tcg: tcgCodeValidator,
    format: v.optional(v.string()),
    colorHex: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  returns: deckValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    if (args.name.length < 1) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Name is required",
      });
    }
    await assertUniqueDeckName(ctx, viewer._id, args.name);
    const timestamp = Date.now();
    const deckId = await ctx.db.insert("decks", {
      userId: viewer._id,
      name: args.name,
      description: args.description,
      tcg: args.tcg,
      format: args.format,
      colorHex: args.colorHex,
      isPublic: args.isPublic ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const deck = await requireDeckForUser(ctx, deckId, viewer._id);
    return await hydrateDeck(ctx, deck);
  },
});

export const update = internalMutation({
  args: {
    subject: v.string(),
    deckId: v.id("decks"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    format: v.optional(v.string()),
    colorHex: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  returns: deckValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const deck = await requireDeckForUser(ctx, args.deckId, viewer._id);
    const hasUpdate =
      args.name !== undefined ||
      args.description !== undefined ||
      args.format !== undefined ||
      args.colorHex !== undefined ||
      args.isPublic !== undefined;
    if (!hasUpdate) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "At least one field must be provided",
      });
    }
    if (args.name !== undefined) {
      if (args.name.length < 1) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "Name is required",
        });
      }
      await assertUniqueDeckName(ctx, viewer._id, args.name, deck._id);
    }
    await ctx.db.patch(deck._id, {
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.description !== undefined
        ? { description: args.description }
        : {}),
      ...(args.format !== undefined ? { format: args.format } : {}),
      ...(args.colorHex !== undefined ? { colorHex: args.colorHex } : {}),
      ...(args.isPublic !== undefined ? { isPublic: args.isPublic } : {}),
      updatedAt: Date.now(),
    });
    const updated = await requireDeckForUser(ctx, deck._id, viewer._id);
    return await hydrateDeck(ctx, updated);
  },
});

export const remove = internalMutation({
  args: {
    subject: v.string(),
    deckId: v.id("decks"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const deck = await requireDeckForUser(ctx, args.deckId, viewer._id);
    const cards = await ctx.db
      .query("deckCards")
      .withIndex("by_deck", (q) => q.eq("deckId", deck._id))
      .take(1000);
    for (const card of cards) {
      await ctx.db.delete(card._id);
    }
    await ctx.db.delete(deck._id);
    return null;
  },
});

export const addCard = internalMutation({
  args: {
    subject: v.string(),
    deckId: v.id("decks"),
    externalId: v.string(),
    tcg: v.string(),
    name: v.string(),
    quantity: v.optional(v.number()),
    zone: v.optional(deckZoneValidator),
    isCommander: v.optional(v.boolean()),
    isSideboard: v.optional(v.boolean()),
    imageUrl: v.optional(v.string()),
    imageUrlSmall: v.optional(v.string()),
    setCode: v.optional(v.string()),
    setName: v.optional(v.string()),
    cardData: v.optional(cardDataValidator),
  },
  returns: deckCardValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const deck = await requireDeckForUser(ctx, args.deckId, viewer._id);
    if (!args.externalId || !args.tcg || !args.name) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "externalId, tcg, and name are required",
      });
    }
    const quantity = positiveInteger(args.quantity ?? 1, "quantity");
    const zone =
      args.zone ??
      (deck.tcg === "yugioh"
        ? inferYugiohZone(args)
        : args.isSideboard
          ? "side"
          : "main");
    const existing = await ctx.db
      .query("deckCards")
      .withIndex("by_deck_and_external_id_and_zone", (q) =>
        q
          .eq("deckId", deck._id)
          .eq("externalId", args.externalId)
          .eq("zone", zone),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        quantity: existing.quantity + quantity,
      });
      const updated = await ctx.db.get(existing._id);
      if (!updated) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Deck card not found",
        });
      }
      return toCardResponse(updated);
    }

    const cardId = await ctx.db.insert("deckCards", {
      deckId: deck._id,
      externalId: args.externalId,
      tcg: args.tcg,
      name: args.name,
      quantity,
      zone,
      isCommander: args.isCommander ?? false,
      isSideboard: zone === "side",
      imageUrl: args.imageUrl,
      imageUrlSmall: args.imageUrlSmall,
      setCode: args.setCode,
      setName: args.setName,
      cardData: args.cardData,
    });
    const card = await ctx.db.get(cardId);
    if (!card) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Deck card not found",
      });
    }
    return toCardResponse(card);
  },
});

export const updateCard = internalMutation({
  args: {
    subject: v.string(),
    deckId: v.id("decks"),
    cardId: v.id("deckCards"),
    quantity: v.optional(v.number()),
    zone: v.optional(deckZoneValidator),
    isCommander: v.optional(v.boolean()),
    isSideboard: v.optional(v.boolean()),
  },
  returns: deckCardValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const deck = await requireDeckForUser(ctx, args.deckId, viewer._id);
    const existing = await requireDeckCard(ctx, deck._id, args.cardId);
    const hasUpdate =
      args.quantity !== undefined ||
      args.zone !== undefined ||
      args.isCommander !== undefined ||
      args.isSideboard !== undefined;
    if (!hasUpdate) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "At least one field must be provided",
      });
    }
    if (args.quantity !== undefined) {
      positiveInteger(args.quantity, "quantity");
    }

    if (args.zone && args.zone !== existing.zone) {
      const target = await ctx.db
        .query("deckCards")
        .withIndex("by_deck_and_external_id_and_zone", (q) =>
          q
            .eq("deckId", deck._id)
            .eq("externalId", existing.externalId)
            .eq("zone", args.zone!),
        )
        .unique();
      if (target) {
        await ctx.db.patch(target._id, {
          quantity: target.quantity + (args.quantity ?? existing.quantity),
        });
        await ctx.db.delete(existing._id);
        const merged = await ctx.db.get(target._id);
        if (!merged) {
          throw new ConvexError({
            code: "NOT_FOUND",
            message: "Deck card not found",
          });
        }
        return toCardResponse(merged);
      }
    }

    const nextZone =
      args.zone ??
      (args.isSideboard !== undefined
        ? args.isSideboard
          ? "side"
          : existing.zone === "side"
            ? "main"
            : existing.zone
        : existing.zone);
    await ctx.db.patch(existing._id, {
      ...(args.quantity !== undefined ? { quantity: args.quantity } : {}),
      ...(args.isCommander !== undefined
        ? { isCommander: args.isCommander }
        : {}),
      zone: nextZone,
      isSideboard: nextZone === "side",
    });
    const updated = await ctx.db.get(existing._id);
    if (!updated) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Deck card not found",
      });
    }
    return toCardResponse(updated);
  },
});

export const removeCard = internalMutation({
  args: {
    subject: v.string(),
    deckId: v.id("decks"),
    cardId: v.id("deckCards"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const deck = await requireDeckForUser(ctx, args.deckId, viewer._id);
    const card = await requireDeckCard(ctx, deck._id, args.cardId);
    await ctx.db.delete(card._id);
    return null;
  },
});

export const analyze = internalQuery({
  args: {
    subject: v.string(),
    deckId: v.id("decks"),
  },
  returns: analysisValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const deck = await requireDeckForUser(ctx, args.deckId, viewer._id);
    const hydrated = await hydrateDeck(ctx, deck);
    const manaCurve: Record<string, number> = {};
    const colorDistribution: Record<string, number> = {};
    const typeDistribution: Record<string, number> = {};
    const rarityDistribution: Record<string, number> = {};
    let totalCmc = 0;
    let cmcCardCount = 0;
    let mainDeckCount = 0;
    let extraDeckCount = 0;
    let sideboardCount = 0;

    for (const card of hydrated.cards) {
      const quantity = card.quantity;
      const data = card.cardData ?? {};
      if (card.zone === "side") sideboardCount += quantity;
      else if (card.zone === "extra") extraDeckCount += quantity;
      else mainDeckCount += quantity;

      const cmc = Number(data.cmc ?? data.level ?? 0);
      if (cmc >= 0) {
        const key = String(cmc);
        manaCurve[key] = (manaCurve[key] ?? 0) + quantity;
        totalCmc += cmc * quantity;
        cmcCardCount += quantity;
      }

      const colors = Array.isArray(data.colors)
        ? (data.colors as string[])
        : [];
      if (colors.length === 0) {
        colorDistribution.Colorless =
          (colorDistribution.Colorless ?? 0) + quantity;
      }
      for (const color of colors) {
        colorDistribution[color] = (colorDistribution[color] ?? 0) + quantity;
      }

      const cardType =
        typeof data.cardType === "string"
          ? data.cardType
          : typeof data.type === "string"
            ? data.type
            : "Unknown";
      const mainType = cardType.split(/[—\-\/]/)[0]!.trim();
      typeDistribution[mainType] = (typeDistribution[mainType] ?? 0) + quantity;

      const rarity = typeof data.rarity === "string" ? data.rarity : "unknown";
      rarityDistribution[rarity] = (rarityDistribution[rarity] ?? 0) + quantity;
    }

    return {
      totalCards: mainDeckCount + extraDeckCount + sideboardCount,
      mainDeckCount,
      extraDeckCount,
      sideboardCount,
      manaCurve,
      colorDistribution,
      typeDistribution,
      rarityDistribution,
      averageCmc:
        cmcCardCount > 0
          ? Math.round((totalCmc / cmcCardCount) * 100) / 100
          : 0,
    };
  },
});

export const ownership = internalQuery({
  args: {
    subject: v.string(),
    deckId: v.id("decks"),
  },
  returns: ownershipValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const deck = await requireDeckForUser(ctx, args.deckId, viewer._id);
    const hydrated = await hydrateDeck(ctx, deck);
    const entries = await ctx.db
      .query("collectionEntries")
      .withIndex("by_user", (q) => q.eq("userId", viewer._id))
      .take(16000);
    const cards = await Promise.all(
      entries.map((entry) => ctx.db.get(entry.cardId)),
    );
    const identities = await Promise.all(
      cards.map((card) =>
        card?.identityId ? ctx.db.get(card.identityId) : null,
      ),
    );
    const quantities = new Map<string, number>();
    for (const [index, entry] of entries.entries()) {
      const card = cards[index];
      if (!card) continue;
      const externalId =
        card.baseExternalId ?? identities[index]?.externalId ?? card.externalId;
      quantities.set(
        externalId,
        (quantities.get(externalId) ?? 0) + entry.quantity,
      );
    }

    const available = new Map(quantities);
    const missingByKey = new Map<
      string,
      { externalId: string; name: string; quantity: number; zone: DeckZone }
    >();
    for (const card of hydrated.cards) {
      const externalId = resolveYugiohBaseId(card);
      let remainingOwned = available.get(externalId) ?? 0;
      for (let copy = 0; copy < Math.max(0, card.quantity); copy += 1) {
        if (remainingOwned > 0) {
          remainingOwned -= 1;
          continue;
        }
        const key = `${card.zone}:${externalId}`;
        const missing = missingByKey.get(key);
        if (missing) missing.quantity += 1;
        else {
          missingByKey.set(key, {
            externalId,
            name: card.name,
            quantity: 1,
            zone: card.zone,
          });
        }
      }
      available.set(externalId, remainingOwned);
    }

    const missing = Array.from(missingByKey.values());
    return {
      owned: Array.from(quantities, ([externalId, quantity]) => ({
        externalId,
        quantity,
      })),
      missing,
      missingCount: missing.reduce((sum, card) => sum + card.quantity, 0),
    };
  },
});

export const exportYdk = internalQuery({
  args: {
    subject: v.string(),
    deckId: v.id("decks"),
  },
  returns: v.object({
    content: v.string(),
    skipped: v.array(
      v.object({
        externalId: v.string(),
        name: v.string(),
        reason: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const deck = await requireDeckForUser(ctx, args.deckId, viewer._id);
    if (deck.tcg !== "yugioh") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "YDK export is only available for Yu-Gi-Oh decks",
      });
    }
    const hydrated = await hydrateDeck(ctx, deck);
    const zones: Record<DeckZone, string[]> = { main: [], extra: [], side: [] };
    const skipped: Array<{ externalId: string; name: string; reason: string }> =
      [];
    for (const card of hydrated.cards) {
      const externalId = resolveYugiohBaseId(card).trim();
      if (!/^\d{8}$/.test(externalId)) {
        skipped.push({
          externalId,
          name: card.name,
          reason: "Yu-Gi-Oh YDK exports require an eight-digit card passcode",
        });
        continue;
      }
      for (let copy = 0; copy < Math.max(0, card.quantity); copy += 1) {
        zones[card.zone].push(externalId);
      }
    }
    return {
      content: [
        "#created by TCGer",
        "#main",
        ...zones.main,
        "#extra",
        ...zones.extra,
        "!side",
        ...zones.side,
      ].join("\n"),
      skipped,
    };
  },
});

function validateMagic(
  cards: ReturnType<typeof toCardResponse>[],
  format: string,
) {
  const formats: Record<
    string,
    {
      minDeck: number;
      maxDeck: number;
      maxCopies: number;
      allowSideboard: boolean;
      maxSideboard: number;
    }
  > = {
    standard: {
      minDeck: 60,
      maxDeck: Infinity,
      maxCopies: 4,
      allowSideboard: true,
      maxSideboard: 15,
    },
    modern: {
      minDeck: 60,
      maxDeck: Infinity,
      maxCopies: 4,
      allowSideboard: true,
      maxSideboard: 15,
    },
    pioneer: {
      minDeck: 60,
      maxDeck: Infinity,
      maxCopies: 4,
      allowSideboard: true,
      maxSideboard: 15,
    },
    legacy: {
      minDeck: 60,
      maxDeck: Infinity,
      maxCopies: 4,
      allowSideboard: true,
      maxSideboard: 15,
    },
    vintage: {
      minDeck: 60,
      maxDeck: Infinity,
      maxCopies: 4,
      allowSideboard: true,
      maxSideboard: 15,
    },
    commander: {
      minDeck: 100,
      maxDeck: 100,
      maxCopies: 1,
      allowSideboard: false,
      maxSideboard: 0,
    },
    pauper: {
      minDeck: 60,
      maxDeck: Infinity,
      maxCopies: 4,
      allowSideboard: true,
      maxSideboard: 15,
    },
  };
  const rules = formats[format.toLowerCase()];
  if (!rules) {
    return {
      valid: true,
      errors: [],
      warnings: [`Unknown format "${format}", skipping validation`],
      format,
    };
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  const mainCount = cards
    .filter((card) => !card.isSideboard)
    .reduce((sum, card) => sum + card.quantity, 0);
  const sideCount = cards
    .filter((card) => card.isSideboard)
    .reduce((sum, card) => sum + card.quantity, 0);
  if (mainCount < rules.minDeck)
    errors.push(
      `Main deck has ${mainCount} cards, minimum is ${rules.minDeck}`,
    );
  if (mainCount > rules.maxDeck)
    errors.push(
      `Main deck has ${mainCount} cards, maximum is ${rules.maxDeck}`,
    );
  if (!rules.allowSideboard && sideCount > 0)
    errors.push(`${format} does not allow a sideboard`);
  if (rules.allowSideboard && sideCount > rules.maxSideboard)
    errors.push(
      `Sideboard has ${sideCount} cards, maximum is ${rules.maxSideboard}`,
    );
  const basicLands = new Set([
    "Plains",
    "Island",
    "Swamp",
    "Mountain",
    "Forest",
    "Wastes",
  ]);
  const counts = new Map<string, number>();
  for (const card of cards) {
    const supertypes = Array.isArray(card.cardData?.supertypes)
      ? card.cardData.supertypes
      : [];
    if (basicLands.has(card.name) || supertypes.includes("Basic")) continue;
    counts.set(card.name, (counts.get(card.name) ?? 0) + card.quantity);
  }
  for (const [name, count] of counts) {
    if (count > rules.maxCopies)
      errors.push(
        `"${name}" has ${count} copies, maximum is ${rules.maxCopies}`,
      );
  }
  if (format.toLowerCase() === "commander") {
    const commanders = cards.filter((card) => card.isCommander);
    if (commanders.length === 0) warnings.push("No commander designated");
    if (commanders.length > 2)
      errors.push("Maximum 2 commanders allowed (partner)");
  }
  return { valid: errors.length === 0, errors, warnings, format };
}

function validatePokemon(
  cards: ReturnType<typeof toCardResponse>[],
  format: string,
) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const totalCount = cards.reduce((sum, card) => sum + card.quantity, 0);
  if (totalCount !== 60)
    errors.push(`Deck has ${totalCount} cards, must be exactly 60`);
  const counts = new Map<string, number>();
  for (const card of cards) {
    const supertype =
      typeof card.cardData?.supertype === "string"
        ? card.cardData.supertype
        : "";
    const subtypes = Array.isArray(card.cardData?.subtypes)
      ? card.cardData.subtypes
      : [];
    if (supertype === "Energy" && subtypes.includes("Basic")) continue;
    counts.set(card.name, (counts.get(card.name) ?? 0) + card.quantity);
  }
  for (const [name, count] of counts) {
    if (count > 4) errors.push(`"${name}" has ${count} copies, maximum is 4`);
  }
  const hasBasicPokemon = cards.some(
    (card) =>
      card.cardData?.supertype === "Pokémon" &&
      Array.isArray(card.cardData?.subtypes) &&
      card.cardData.subtypes.includes("Basic"),
  );
  if (!hasBasicPokemon)
    warnings.push("Deck has no Basic Pokémon — you cannot start the game");
  if (format.toLowerCase() === "standard") {
    warnings.push(
      "Standard format rotation check requires regulation mark data",
    );
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    format: format || "standard",
  };
}

function validateYugioh(
  cards: ReturnType<typeof toCardResponse>[],
  format: string,
) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const mainCount = cards
    .filter((card) => card.zone === "main")
    .reduce((sum, card) => sum + card.quantity, 0);
  const extraCount = cards
    .filter((card) => card.zone === "extra")
    .reduce((sum, card) => sum + card.quantity, 0);
  const sideCount = cards
    .filter((card) => card.zone === "side")
    .reduce((sum, card) => sum + card.quantity, 0);
  if (mainCount < 40)
    errors.push(`Main Deck has ${mainCount} cards, minimum is 40`);
  if (mainCount > 60)
    errors.push(`Main Deck has ${mainCount} cards, maximum is 60`);
  if (extraCount > 15)
    errors.push(`Extra Deck has ${extraCount} cards, maximum is 15`);
  if (sideCount > 15)
    errors.push(`Side Deck has ${sideCount} cards, maximum is 15`);
  const counts = new Map<string, { name: string; count: number }>();
  for (const card of cards) {
    const externalId = resolveYugiohBaseId(card);
    const current = counts.get(externalId) ?? { name: card.name, count: 0 };
    current.count += card.quantity;
    counts.set(externalId, current);
  }
  for (const { name, count } of counts.values()) {
    if (count > 3) errors.push(`"${name}" has ${count} copies, maximum is 3`);
  }
  if (mainCount > 0 && mainCount < 40)
    warnings.push("Deck is below minimum size");
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    format: format || "tcg",
  };
}

export const validate = internalQuery({
  args: {
    subject: v.string(),
    deckId: v.id("decks"),
    format: v.optional(v.string()),
    banlist: v.optional(banlistValidator),
  },
  returns: validationResultValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const deck = await requireDeckForUser(ctx, args.deckId, viewer._id);
    const hydrated = await hydrateDeck(ctx, deck);
    const format = args.format || deck.format;
    let result;
    if (deck.tcg === "magic")
      result = validateMagic(hydrated.cards, format || "standard");
    else if (deck.tcg === "yugioh")
      result = validateYugioh(hydrated.cards, format || "tcg");
    else if (deck.tcg === "pokemon")
      result = validatePokemon(hydrated.cards, format || "standard");
    else {
      result = {
        valid: true,
        errors: [],
        warnings: [`Unknown TCG "${deck.tcg}"`],
      };
    }

    if (deck.tcg !== "yugioh" || !args.banlist) return result;
    const violations: Array<{
      externalId?: string;
      name?: string;
      zone?: DeckZone;
      message: string;
    }> = [];
    let points: number | undefined;
    if (args.banlist.type === "genesys") {
      points = hydrated.cards.reduce(
        (sum, card) =>
          sum +
          (args.banlist!.type === "genesys"
            ? (args.banlist!.cards[resolveYugiohBaseId(card)] ?? 0) *
              Math.max(0, card.quantity)
            : 0),
        0,
      );
      if (points > args.banlist.maxPoints) {
        violations.push({
          message: `${args.banlist.name} points total is ${points}; maximum is ${args.banlist.maxPoints}`,
        });
      }
    } else {
      const counts = new Map<
        string,
        { count: number; name: string; zones: Set<DeckZone> }
      >();
      for (const card of hydrated.cards) {
        const externalId = resolveYugiohBaseId(card);
        const usage = counts.get(externalId) ?? {
          count: 0,
          name: card.name,
          zones: new Set<DeckZone>(),
        };
        usage.count += Math.max(0, card.quantity);
        usage.zones.add(card.zone);
        counts.set(externalId, usage);
      }
      for (const [externalId, usage] of counts) {
        const status = args.banlist.cards[externalId];
        const normalized = status?.trim().toLowerCase();
        const limit =
          normalized === "forbidden" || normalized === "banned"
            ? 0
            : normalized === "limited"
              ? 1
              : normalized === "semi-limited" || normalized === "semilimited"
                ? 2
                : 3;
        if (usage.count <= limit) continue;
        for (const zone of usage.zones) {
          violations.push({
            externalId,
            name: usage.name,
            zone,
            message: `${usage.name} has ${usage.count} copies; ${status ?? "default"} limit is ${limit}`,
          });
        }
      }
    }
    return {
      ...result,
      valid: result.valid && violations.length === 0,
      errors: [
        ...result.errors,
        ...violations.map((violation) => violation.message),
      ],
      points,
      violations,
    };
  },
});
