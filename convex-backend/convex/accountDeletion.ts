import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

const phaseValidator = v.union(
  v.literal("collectionEntries"),
  v.literal("binders"),
  v.literal("tags"),
  v.literal("wishlists"),
  v.literal("follows"),
  v.literal("decks"),
  v.literal("sealedCards"),
  v.literal("sealedOpenings"),
  v.literal("sealedInventory"),
  v.literal("transactions"),
  v.literal("financeSummaries"),
  v.literal("trades"),
  v.literal("audits"),
  v.literal("snapshots"),
  v.literal("user"),
);

type DeletionPhase =
  | "collectionEntries"
  | "binders"
  | "tags"
  | "wishlists"
  | "follows"
  | "decks"
  | "sealedCards"
  | "sealedOpenings"
  | "sealedInventory"
  | "transactions"
  | "financeSummaries"
  | "trades"
  | "audits"
  | "snapshots"
  | "user";

const nextPhase: Record<DeletionPhase, DeletionPhase | null> = {
  collectionEntries: "binders",
  binders: "tags",
  tags: "wishlists",
  wishlists: "follows",
  follows: "decks",
  decks: "sealedCards",
  sealedCards: "sealedOpenings",
  sealedOpenings: "sealedInventory",
  sealedInventory: "transactions",
  transactions: "financeSummaries",
  financeSummaries: "trades",
  trades: "audits",
  audits: "snapshots",
  snapshots: "user",
  user: null,
};

const batchSize = 50;

export const request = internalMutation({
  args: { authSubject: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_auth_subject", (q) =>
        q.eq("authSubject", args.authSubject),
      )
      .unique();

    if (user) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.deleteBatch, {
        userId: user._id,
        phase: "collectionEntries",
      });
    }

    return null;
  },
});

export const deleteBatch = internalMutation({
  args: {
    userId: v.id("users"),
    phase: phaseValidator,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const schedule = async (phase: DeletionPhase) => {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.deleteBatch, {
        userId: args.userId,
        phase,
      });
    };

    const advance = async () => {
      const next = nextPhase[args.phase];
      if (next) {
        await schedule(next);
      }
    };

    if (args.phase === "collectionEntries") {
      const entry = await ctx.db
        .query("collectionEntries")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .first();
      if (!entry) {
        await advance();
        return null;
      }

      const assignments = await ctx.db
        .query("collectionEntryTags")
        .withIndex("by_entry", (q) => q.eq("entryId", entry._id))
        .take(batchSize);
      const openedCards = await ctx.db
        .query("sealedOpenedCards")
        .withIndex("by_collection", (q) => q.eq("collectionId", entry._id))
        .take(batchSize);
      if (assignments.length > 0 || openedCards.length > 0) {
        await Promise.all([
          ...assignments.map((assignment) => ctx.db.delete(assignment._id)),
          ...openedCards.map((card) => ctx.db.delete(card._id)),
        ]);
        await schedule(args.phase);
        return null;
      }

      for (const storageId of entry.imageStorageIds ?? []) {
        if (await ctx.storage.getUrl(storageId)) {
          await ctx.storage.delete(storageId);
        }
      }
      await ctx.db.delete(entry._id);
      await schedule(args.phase);
      return null;
    }

    if (args.phase === "binders") {
      const binder = await ctx.db
        .query("binders")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .first();
      if (!binder) {
        await advance();
        return null;
      }

      const pages = await ctx.db
        .query("binderPages")
        .withIndex("by_binder", (q) => q.eq("binderId", binder._id))
        .take(batchSize);
      if (pages.length > 0) {
        for (const page of pages) {
          if (page.imageStorageId) {
            if (await ctx.storage.getUrl(page.imageStorageId)) {
              await ctx.storage.delete(page.imageStorageId);
            }
          }
          await ctx.db.delete(page._id);
        }
        await schedule(args.phase);
        return null;
      }

      await ctx.db.delete(binder._id);
      await schedule(args.phase);
      return null;
    }

    if (args.phase === "tags") {
      const tag = await ctx.db
        .query("tags")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .first();
      if (!tag) {
        await advance();
        return null;
      }
      const assignments = await ctx.db
        .query("collectionEntryTags")
        .withIndex("by_tag", (q) => q.eq("tagId", tag._id))
        .take(batchSize);
      if (assignments.length > 0) {
        await Promise.all(
          assignments.map((assignment) => ctx.db.delete(assignment._id)),
        );
      } else {
        await ctx.db.delete(tag._id);
      }
      await schedule(args.phase);
      return null;
    }

    if (args.phase === "wishlists") {
      const wishlist = await ctx.db
        .query("wishlists")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .first();
      if (!wishlist) {
        await advance();
        return null;
      }
      const [cards, rules, follows] = await Promise.all([
        ctx.db
          .query("wishlistCards")
          .withIndex("by_wishlist", (q) => q.eq("wishlistId", wishlist._id))
          .take(batchSize),
        ctx.db
          .query("wishlistRules")
          .withIndex("by_wishlist", (q) => q.eq("wishlistId", wishlist._id))
          .take(batchSize),
        ctx.db
          .query("userGuideFollows")
          .withIndex("by_wishlist", (q) => q.eq("wishlistId", wishlist._id))
          .take(batchSize),
      ]);
      if (cards.length > 0 || rules.length > 0 || follows.length > 0) {
        await Promise.all([
          ...cards.map((card) => ctx.db.delete(card._id)),
          ...rules.map((rule) => ctx.db.delete(rule._id)),
          ...follows.map((follow) => ctx.db.delete(follow._id)),
        ]);
      } else {
        await ctx.db.delete(wishlist._id);
      }
      await schedule(args.phase);
      return null;
    }

    if (args.phase === "follows") {
      const docs = await ctx.db
        .query("userGuideFollows")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .take(batchSize);
      if (docs.length > 0) {
        await Promise.all(docs.map((doc) => ctx.db.delete(doc._id)));
        await schedule(args.phase);
      } else {
        await advance();
      }
      return null;
    }

    if (args.phase === "decks") {
      const deck = await ctx.db
        .query("decks")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .first();
      if (!deck) {
        await advance();
        return null;
      }
      const cards = await ctx.db
        .query("deckCards")
        .withIndex("by_deck", (q) => q.eq("deckId", deck._id))
        .take(batchSize);
      if (cards.length > 0) {
        await Promise.all(cards.map((card) => ctx.db.delete(card._id)));
      } else {
        await ctx.db.delete(deck._id);
      }
      await schedule(args.phase);
      return null;
    }

    if (args.phase === "sealedCards") {
      const docs = await ctx.db
        .query("sealedOpenedCards")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .take(batchSize);
      if (docs.length > 0) {
        await Promise.all(docs.map((doc) => ctx.db.delete(doc._id)));
        await schedule(args.phase);
      } else {
        await advance();
      }
      return null;
    }

    if (args.phase === "sealedOpenings") {
      const opening = await ctx.db
        .query("sealedOpenings")
        .withIndex("by_user_and_opened_at", (q) => q.eq("userId", args.userId))
        .first();
      if (!opening) {
        await advance();
        return null;
      }
      const cards = await ctx.db
        .query("sealedOpenedCards")
        .withIndex("by_opening", (q) => q.eq("openingId", opening._id))
        .take(batchSize);
      if (cards.length > 0) {
        await Promise.all(cards.map((card) => ctx.db.delete(card._id)));
      } else {
        await ctx.db.delete(opening._id);
      }
      await schedule(args.phase);
      return null;
    }

    if (args.phase === "sealedInventory") {
      const docs = await ctx.db
        .query("sealedInventory")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .take(batchSize);
      if (docs.length > 0) {
        await Promise.all(docs.map((doc) => ctx.db.delete(doc._id)));
        await schedule(args.phase);
      } else {
        await advance();
      }
      return null;
    }

    if (args.phase === "transactions") {
      const docs = await ctx.db
        .query("transactions")
        .withIndex("by_user_and_date", (q) => q.eq("userId", args.userId))
        .take(batchSize);
      if (docs.length > 0) {
        await Promise.all(docs.map((doc) => ctx.db.delete(doc._id)));
        await schedule(args.phase);
      } else {
        await advance();
      }
      return null;
    }

    if (args.phase === "financeSummaries") {
      const docs = await ctx.db
        .query("financeSummaries")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .take(batchSize);
      if (docs.length > 0) {
        await Promise.all(docs.map((doc) => ctx.db.delete(doc._id)));
        await schedule(args.phase);
      } else {
        await advance();
      }
      return null;
    }

    if (args.phase === "trades") {
      const sent = await ctx.db
        .query("trades")
        .withIndex("by_sender", (q) => q.eq("senderId", args.userId))
        .first();
      const received = sent
        ? null
        : await ctx.db
            .query("trades")
            .withIndex("by_receiver", (q) => q.eq("receiverId", args.userId))
            .first();
      const trade = sent ?? received;
      if (!trade) {
        await advance();
        return null;
      }
      const cards = await ctx.db
        .query("tradeCards")
        .withIndex("by_trade", (q) => q.eq("tradeId", trade._id))
        .take(batchSize);
      if (cards.length > 0) {
        await Promise.all(cards.map((card) => ctx.db.delete(card._id)));
      } else {
        await ctx.db.delete(trade._id);
      }
      await schedule(args.phase);
      return null;
    }

    if (args.phase === "audits") {
      const docs = await ctx.db
        .query("collectionMutationAudits")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .take(batchSize);
      if (docs.length > 0) {
        await Promise.all(docs.map((doc) => ctx.db.delete(doc._id)));
        await schedule(args.phase);
      } else {
        await advance();
      }
      return null;
    }

    if (args.phase === "snapshots") {
      const docs = await ctx.db
        .query("collectionValueSnapshots")
        .withIndex("by_user_and_day", (q) => q.eq("userId", args.userId))
        .take(batchSize);
      if (docs.length > 0) {
        await Promise.all(docs.map((doc) => ctx.db.delete(doc._id)));
        await schedule(args.phase);
      } else {
        await advance();
      }
      return null;
    }

    const userId = args.userId as Id<"users">;
    const user = await ctx.db.get(userId);
    if (user) {
      await ctx.db.delete(userId);
    }
    return null;
  },
});
