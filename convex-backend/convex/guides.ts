import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx
} from "./_generated/server";
import { tcgCodeValidator } from "./lib/validators";

const guideCategoryValidator = v.union(
  v.literal("art-style"),
  v.literal("artist"),
  v.literal("species"),
  v.literal("story"),
  v.literal("cameo"),
  v.literal("custom")
);

const guideRuleTypeValidator = v.union(
  v.literal("name"),
  v.literal("set"),
  v.literal("artist")
);

const guideRuleValidator = v.object({
  type: guideRuleTypeValidator,
  tcg: tcgCodeValidator,
  query: v.optional(v.string()),
  setCode: v.optional(v.string()),
  setName: v.optional(v.string()),
  includeAllPrintings: v.boolean()
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
  wishlistId: v.optional(v.id("wishlists"))
});

const followResponseValidator = v.object({
  guide: guideResponseValidator,
  wishlistId: v.id("wishlists"),
  created: v.boolean()
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
      message: "The current user has not been provisioned"
    });
  }
  return viewer;
}

async function findFollow(
  ctx: ReaderCtx,
  userId: Id<"users">,
  guideId: Id<"collectionGuides">
) {
  return await ctx.db
    .query("userGuideFollows")
    .withIndex("by_user_and_guide", (query) =>
      query.eq("userId", userId).eq("guideId", guideId)
    )
    .unique();
}

function toGuideResponse(
  guide: Doc<"collectionGuides">,
  follow: Doc<"userGuideFollows"> | null
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
      includeAllPrintings: guide.includeAllPrintings
    },
    cardCountHint: guide.cardCountHint,
    followed: follow !== null,
    wishlistId: follow?.wishlistId
  };
}

async function uniqueWishlistName(ctx: MutationCtx, userId: Id<"users">, preferred: string) {
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix === 0 ? preferred : `${preferred} ${suffix + 1}`;
    const existing = await ctx.db
      .query("wishlists")
      .withIndex("by_user_name", (query) =>
        query.eq("userId", userId).eq("name", candidate)
      )
      .unique();
    if (!existing) return candidate;
  }
  throw new ConvexError({
    code: "CONFLICT",
    message: "Could not create a unique wishlist name for this guide"
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
      guides.map((guide) => findFollow(ctx, viewer._id, guide._id))
    );
    return guides
      .map((guide, index) => toGuideResponse(guide, follows[index] ?? null))
      .sort((left, right) =>
        Number(right.featured) - Number(left.featured) || left.title.localeCompare(right.title)
      );
  }
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
      throw new ConvexError({ code: "NOT_FOUND", message: "Collection guide not found" });
    }
    return toGuideResponse(guide, await findFollow(ctx, viewer._id, guide._id));
  }
});

export const follow = internalMutation({
  args: {
    subject: v.string(),
    slug: v.string(),
    wishlistName: v.optional(v.string())
  },
  returns: followResponseValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const guide = await ctx.db
      .query("collectionGuides")
      .withIndex("by_slug", (query) => query.eq("slug", args.slug))
      .unique();
    if (!guide || guide.status !== "published") {
      throw new ConvexError({ code: "NOT_FOUND", message: "Collection guide not found" });
    }

    const existingFollow = await findFollow(ctx, viewer._id, guide._id);
    if (existingFollow) {
      return {
        guide: toGuideResponse(guide, existingFollow),
        wishlistId: existingFollow.wishlistId,
        created: false
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
      updatedAt: timestamp
    });
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
      updatedAt: timestamp
    });
    const followId = await ctx.db.insert("userGuideFollows", {
      userId: viewer._id,
      guideId: guide._id,
      wishlistId,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const createdFollow = await ctx.db.get(followId);
    if (!createdFollow) {
      throw new ConvexError({ code: "INVARIANT", message: "Guide follow was not created" });
    }
    return {
      guide: toGuideResponse(guide, createdFollow),
      wishlistId,
      created: true
    };
  }
});

/** Re-runnable system seed. Guide membership remains rule-driven and updates with the catalog. */
export const seedSystemGuides = internalMutation({
  args: {},
  returns: v.object({ upserted: v.number() }),
  handler: async (ctx) => {
    const timestamp = Date.now();
    const systemGuides = [{
      slug: "pokemon-clay-art",
      title: "The Clay Collection",
      description:
        "A living guide to English Pokémon cards illustrated by Yuka Morii, best known for hand-sculpted clay scenes.",
      tcg: "pokemon" as const,
      category: "art-style" as const,
      coverImageUrl: "https://assets.tcgdex.net/en/sm/sm6/1/high.webp",
      curatorName: "TCGer",
      tags: ["Clay", "Sculpture", "Photography", "Yuka Morii"],
      version: 1,
      featured: true,
      status: "published" as const,
      ruleType: "artist" as const,
      ruleQuery: "Yuka Morii",
      includeAllPrintings: true,
      matchAnyPrinting: false,
      cardCountHint: 224,
      updatedAt: timestamp
    }, {
      slug: "every-ditto",
      title: "Every Ditto",
      description: "Every English Pokémon TCG printing named Ditto, kept current as new sets are released.",
      tcg: "pokemon" as const,
      category: "species" as const,
      coverImageUrl: "https://assets.tcgdex.net/en/base/base3/3/high.webp",
      curatorName: "TCGer",
      tags: ["Ditto", "Pokémon", "Species Collection"],
      version: 1,
      featured: true,
      status: "published" as const,
      ruleType: "name" as const,
      ruleQuery: "Ditto",
      includeAllPrintings: true,
      matchAnyPrinting: false,
      cardCountHint: 30,
      updatedAt: timestamp
    }];

    for (const guide of systemGuides) {
      const existing = await ctx.db
        .query("collectionGuides")
        .withIndex("by_slug", (query) => query.eq("slug", guide.slug))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, guide);
      } else {
        await ctx.db.insert("collectionGuides", { ...guide, createdAt: timestamp });
      }
    }
    return { upserted: systemGuides.length };
  }
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
  }
});
