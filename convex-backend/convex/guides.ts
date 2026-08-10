import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { tcgCodeValidator } from "./lib/validators";
import { systemGuideDefinitions } from "../system-guides.generated";

const guideCategoryValidator = v.union(
  v.literal("art-style"),
  v.literal("artist"),
  v.literal("species"),
  v.literal("story"),
  v.literal("cameo"),
  v.literal("custom"),
);

const guideRuleTypeValidator = v.union(
  v.literal("name"),
  v.literal("set"),
  v.literal("artist"),
  v.literal("tag"),
  v.literal("manual"),
);

const guideRuleValidator = v.object({
  type: guideRuleTypeValidator,
  tcg: tcgCodeValidator,
  query: v.optional(v.string()),
  setCode: v.optional(v.string()),
  setName: v.optional(v.string()),
  includeAllPrintings: v.boolean(),
});

const guideResponseValidator = v.object({
  id: v.id("collectionGuides"),
  slug: v.string(),
  title: v.string(),
  description: v.string(),
  tcg: tcgCodeValidator,
  category: guideCategoryValidator,
  coverImageUrl: v.optional(v.string()),
  curatorName: v.string(),
  tags: v.array(v.string()),
  version: v.number(),
  featured: v.boolean(),
  rule: guideRuleValidator,
  cardCountHint: v.optional(v.number()),
  followed: v.boolean(),
  wishlistId: v.optional(v.id("wishlists")),
});

const followResponseValidator = v.object({
  guide: guideResponseValidator,
  wishlistId: v.id("wishlists"),
  created: v.boolean(),
});

const guideItemResponseValidator = v.object({
  id: v.id("collectionGuideItems"),
  guideId: v.id("collectionGuides"),
  tcg: tcgCodeValidator,
  externalId: v.string(),
  name: v.string(),
  setCode: v.optional(v.string()),
  setName: v.optional(v.string()),
  collectorNumber: v.optional(v.string()),
  rarity: v.optional(v.string()),
  artist: v.optional(v.string()),
  variant: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  imageUrlSmall: v.optional(v.string()),
  groupKey: v.optional(v.string()),
  groupLabel: v.optional(v.string()),
  groupOrder: v.optional(v.number()),
  position: v.number(),
  note: v.optional(v.string()),
  provenanceUrl: v.optional(v.string()),
});

type ReaderCtx = QueryCtx | MutationCtx;

async function requireViewerBySubject(ctx: ReaderCtx, subject: string) {
  const viewer = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (query) => query.eq("authSubject", subject))
    .unique();
  if (!viewer) {
    throw new ConvexError({
      code: "USER_NOT_PROVISIONED",
      message: "The current user has not been provisioned",
    });
  }
  return viewer;
}

async function findFollow(
  ctx: ReaderCtx,
  userId: Id<"users">,
  guideId: Id<"collectionGuides">,
) {
  return await ctx.db
    .query("userGuideFollows")
    .withIndex("by_user_and_guide", (query) =>
      query.eq("userId", userId).eq("guideId", guideId),
    )
    .unique();
}

function toGuideResponse(
  guide: Doc<"collectionGuides">,
  follow: Doc<"userGuideFollows"> | null,
) {
  return {
    id: guide._id,
    slug: guide.slug,
    title: guide.title,
    description: guide.description,
    tcg: guide.tcg,
    category: guide.category,
    coverImageUrl: guide.coverImageUrl,
    curatorName: guide.curatorName,
    tags: guide.tags,
    version: guide.version,
    featured: guide.featured,
    rule: {
      type: guide.ruleType,
      tcg: guide.tcg,
      query: guide.ruleQuery,
      setCode: guide.ruleSetCode,
      setName: guide.ruleSetName,
      includeAllPrintings: guide.includeAllPrintings,
    },
    cardCountHint: guide.cardCountHint,
    followed: follow !== null,
    wishlistId: follow?.wishlistId,
  };
}

async function uniqueWishlistName(
  ctx: MutationCtx,
  userId: Id<"users">,
  preferred: string,
) {
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix === 0 ? preferred : `${preferred} ${suffix + 1}`;
    const existing = await ctx.db
      .query("wishlists")
      .withIndex("by_user_name", (query) =>
        query.eq("userId", userId).eq("name", candidate),
      )
      .unique();
    if (!existing) return candidate;
  }
  throw new ConvexError({
    code: "CONFLICT",
    message: "Could not create a unique wishlist name for this guide",
  });
}

export const listPublished = internalQuery({
  args: { subject: v.string() },
  returns: v.array(guideResponseValidator),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const guides = await ctx.db
      .query("collectionGuides")
      .withIndex("by_status", (query) => query.eq("status", "published"))
      .take(100);
    const follows = await Promise.all(
      guides.map((guide) => findFollow(ctx, viewer._id, guide._id)),
    );
    return guides
      .map((guide, index) => toGuideResponse(guide, follows[index] ?? null))
      .sort(
        (left, right) =>
          Number(right.featured) - Number(left.featured) ||
          left.title.localeCompare(right.title),
      );
  },
});

export const getPublishedBySlug = internalQuery({
  args: { subject: v.string(), slug: v.string() },
  returns: guideResponseValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const guide = await ctx.db
      .query("collectionGuides")
      .withIndex("by_slug", (query) => query.eq("slug", args.slug))
      .unique();
    if (!guide || guide.status !== "published") {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Collection guide not found",
      });
    }
    return toGuideResponse(guide, await findFollow(ctx, viewer._id, guide._id));
  },
});

export const listPublishedItems = internalQuery({
  args: { subject: v.string(), slug: v.string() },
  returns: v.array(guideItemResponseValidator),
  handler: async (ctx, args) => {
    await requireViewerBySubject(ctx, args.subject);
    const guide = await ctx.db
      .query("collectionGuides")
      .withIndex("by_slug", (query) => query.eq("slug", args.slug))
      .unique();
    if (!guide || guide.status !== "published") {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Collection guide not found",
      });
    }
    const items = await ctx.db
      .query("collectionGuideItems")
      .withIndex("by_guide", (query) => query.eq("guideId", guide._id))
      .take(2000);
    return items
      .sort(
        (left, right) =>
          (left.groupOrder ?? 0) - (right.groupOrder ?? 0) ||
          left.position - right.position,
      )
      .map((item) => ({
        id: item._id,
        guideId: item.guideId,
        tcg: item.tcg,
        externalId: item.externalId,
        name: item.name,
        setCode: item.setCode,
        setName: item.setName,
        collectorNumber: item.collectorNumber,
        rarity: item.rarity,
        artist: item.artist,
        variant: item.variant,
        imageUrl: item.imageUrl,
        imageUrlSmall: item.imageUrlSmall,
        groupKey: item.groupKey,
        groupLabel: item.groupLabel,
        groupOrder: item.groupOrder,
        position: item.position,
        note: item.note,
        provenanceUrl: item.provenanceUrl,
      }));
  },
});

export const listOwnedCardKeys = internalQuery({
  args: { subject: v.string() },
  returns: v.array(v.object({ key: v.string(), quantity: v.number() })),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const entries = await ctx.db
      .query("collectionEntries")
      .withIndex("by_user", (query) => query.eq("userId", viewer._id))
      .take(5000);
    const cards = await Promise.all(entries.map((entry) => ctx.db.get(entry.cardId)));
    const quantities = new Map<string, number>();
    for (const [index, card] of cards.entries()) {
      if (!card) continue;
      const key = `${card.tcg}:${card.externalId}`;
      quantities.set(key, (quantities.get(key) ?? 0) + entries[index]!.quantity);
    }
    return [...quantities.entries()].map(([key, quantity]) => ({ key, quantity }));
  },
});

export const follow = internalMutation({
  args: {
    subject: v.string(),
    slug: v.string(),
    wishlistName: v.optional(v.string()),
  },
  returns: followResponseValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const guide = await ctx.db
      .query("collectionGuides")
      .withIndex("by_slug", (query) => query.eq("slug", args.slug))
      .unique();
    if (!guide || guide.status !== "published") {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Collection guide not found",
      });
    }

    const existingFollow = await findFollow(ctx, viewer._id, guide._id);
    if (existingFollow) {
      return {
        guide: toGuideResponse(guide, existingFollow),
        wishlistId: existingFollow.wishlistId,
        created: false,
      };
    }

    const requestedName = args.wishlistName?.trim() || guide.title;
    const name = await uniqueWishlistName(ctx, viewer._id, requestedName);
    const timestamp = Date.now();
    const wishlistId = await ctx.db.insert("wishlists", {
      userId: viewer._id,
      name,
      description: `Following the “${guide.title}” collection guide.`,
      colorHex: "B86F47",
      matchAnyPrinting: guide.matchAnyPrinting,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    if (guide.ruleType === "manual") {
      const items = await ctx.db
        .query("collectionGuideItems")
        .withIndex("by_guide", (query) => query.eq("guideId", guide._id))
        .take(2000);
      const inserted = new Set<string>();
      for (const item of items) {
        const key = `${item.tcg}:${item.externalId}`;
        if (inserted.has(key)) continue;
        inserted.add(key);
        await ctx.db.insert("wishlistCards", {
          wishlistId,
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
          notes: item.note,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    } else {
      await ctx.db.insert("wishlistRules", {
        wishlistId,
        type: guide.ruleType,
        tcg: guide.tcg,
        query: guide.ruleQuery,
        setCode: guide.ruleSetCode,
        setName: guide.ruleSetName,
        includeAllPrintings: guide.includeAllPrintings,
        autoSync: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    const followId = await ctx.db.insert("userGuideFollows", {
      userId: viewer._id,
      guideId: guide._id,
      wishlistId,
      guideVersion: guide.version,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const createdFollow = await ctx.db.get(followId);
    if (!createdFollow) {
      throw new ConvexError({
        code: "INVARIANT",
        message: "Guide follow was not created",
      });
    }
    return {
      guide: toGuideResponse(guide, createdFollow),
      wishlistId,
      created: true,
    };
  },
});

/** Re-runnable system seed. Guide membership remains rule-driven and updates with the catalog. */
export const seedSystemGuides = internalMutation({
  args: {},
  returns: v.object({ upserted: v.number() }),
  handler: async (ctx) => {
    const timestamp = Date.now();
    const systemGuides = systemGuideDefinitions.map((guide) => ({
      ...guide,
      tags: [...guide.tags],
      status: "published" as const,
      updatedAt: timestamp,
    }));

    for (const guide of systemGuides) {
      const existing = await ctx.db
        .query("collectionGuides")
        .withIndex("by_slug", (query) => query.eq("slug", guide.slug))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, guide);
      } else {
        await ctx.db.insert("collectionGuides", {
          ...guide,
          createdAt: timestamp,
        });
      }
    }

    const connectedGuide = await ctx.db
      .query("collectionGuides")
      .withIndex("by_slug", (query) =>
        query.eq("slug", "pokemon-crown-zenith-connected-art"),
      )
      .unique();
    if (!connectedGuide) {
      throw new ConvexError({
        code: "INVARIANT",
        message: "Connected-art guide could not be seeded",
      });
    }

    const connectedCards = [
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
    for (const [position, [collectorNumber, name]] of connectedCards.entries()) {
      const externalId = `swsh12.5gg-${collectorNumber}`;
      const imageRoot = `https://images.pokemontcg.io/swsh12pt5gg/${collectorNumber}`;
      const item = {
        guideId: connectedGuide._id,
        tcg: "pokemon" as const,
        externalId,
        name,
        setCode: "swsh12.5gg",
        setName: "Crown Zenith Galarian Gallery",
        collectorNumber,
        rarity: "Rare",
        artist: "Kouki Saitou",
        imageUrl: `${imageRoot}_hires.png`,
        imageUrlSmall: `${imageRoot}.png`,
        groupKey: "crown-zenith-nine-card-scene",
        groupLabel: "Crown Zenith nine-card scene",
        groupOrder: 0,
        position,
        source: "curated" as const,
        guideVersion: connectedGuide.version,
        searchText:
          `${name} Crown Zenith Galarian Gallery Connected Art Panorama Kouki Saitou`.toLowerCase(),
        provenanceUrl:
          "https://bulbapedia.bulbagarden.net/wiki/Bidoof_(Crown_Zenith_111)",
        reviewedAt: timestamp,
        updatedAt: timestamp,
      };
      const existing = await ctx.db
        .query("collectionGuideItems")
        .withIndex("by_guide_and_external_id", (query) =>
          query.eq("guideId", connectedGuide._id).eq("externalId", externalId),
        )
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, item);
      } else {
        await ctx.db.insert("collectionGuideItems", {
          ...item,
          createdAt: timestamp,
        });
      }
    }
    return { upserted: systemGuides.length };
  },
});

export const countPublished = internalQuery({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const guides = await ctx.db
      .query("collectionGuides")
      .withIndex("by_status", (query) => query.eq("status", "published"))
      .take(100);
    return guides.length;
  },
});
