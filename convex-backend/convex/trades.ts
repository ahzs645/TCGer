import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx
} from "./_generated/server";
import { tcgCodeValidator } from "./lib/validators";

const tradeStatusValidator = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("cancelled")
);

const tradeCardInputValidator = v.object({
  externalId: v.string(),
  tcg: tcgCodeValidator,
  name: v.string(),
  quantity: v.number(),
  imageUrl: v.optional(v.string()),
  estimatedValue: v.optional(v.number())
});

const tradeCardResponseValidator = v.object({
  id: v.string(),
  side: v.union(v.literal("sender"), v.literal("receiver")),
  externalId: v.string(),
  tcg: v.string(),
  name: v.string(),
  quantity: v.number(),
  imageUrl: v.optional(v.string()),
  estimatedValue: v.optional(v.number())
});

const tradeResponseValidator = v.object({
  id: v.string(),
  senderId: v.string(),
  receiverId: v.string(),
  status: tradeStatusValidator,
  message: v.optional(v.string()),
  cards: v.array(tradeCardResponseValidator),
  createdAt: v.string(),
  updatedAt: v.string()
});

const matchCardValidator = v.object({
  externalId: v.string(),
  tcg: v.string(),
  name: v.string()
});

const tradeMatchValidator = v.object({
  userId: v.string(),
  username: v.optional(v.string()),
  theyHave: v.array(matchCardValidator),
  youHave: v.array(matchCardValidator),
  matchScore: v.number()
});

type ReaderCtx = QueryCtx | MutationCtx;
type MatchCard = { externalId: string; tcg: string; name: string };

function notFound() {
  return new ConvexError({ code: "NOT_FOUND", message: "Trade not found" });
}

function badRequest(message: string) {
  return new ConvexError({ code: "BAD_REQUEST", message });
}

function forbidden(message: string) {
  return new ConvexError({ code: "FORBIDDEN", message });
}

async function requireUserBySubject(ctx: ReaderCtx, subject: string) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", subject))
    .unique();
  if (!user) {
    throw new ConvexError({
      code: "USER_NOT_PROVISIONED",
      message: "Viewer was not provisioned"
    });
  }
  return user;
}

async function tradeByStringId(ctx: ReaderCtx, tradeId: string) {
  const normalizedId = ctx.db.normalizeId("trades", tradeId);
  if (!normalizedId) return null;
  return await ctx.db.get(normalizedId);
}

async function hydrateTrade(ctx: ReaderCtx, trade: Doc<"trades">) {
  const [sender, receiver, cards] = await Promise.all([
    ctx.db.get(trade.senderId),
    ctx.db.get(trade.receiverId),
    ctx.db
      .query("tradeCards")
      .withIndex("by_trade", (q) => q.eq("tradeId", trade._id))
      .take(100)
  ]);
  if (!sender || !receiver) {
    throw new ConvexError({
      code: "INVARIANT",
      message: "Trade participant is missing"
    });
  }
  return {
    id: String(trade._id),
    senderId: sender.authSubject,
    receiverId: receiver.authSubject,
    status: trade.status,
    message: trade.message,
    cards: cards.map((card) => ({
      id: String(card._id),
      side: card.side,
      externalId: card.externalId,
      tcg: card.tcg,
      name: card.name,
      quantity: card.quantity,
      imageUrl: card.imageUrl,
      estimatedValue: card.estimatedValue
    })),
    createdAt: new Date(trade.createdAt).toISOString(),
    updatedAt: new Date(trade.updatedAt).toISOString()
  };
}

function isParticipant(trade: Doc<"trades">, userId: Id<"users">) {
  return trade.senderId === userId || trade.receiverId === userId;
}

export const list = internalQuery({
  args: { subject: v.string() },
  returns: v.array(tradeResponseValidator),
  handler: async (ctx, args) => {
    const user = await requireUserBySubject(ctx, args.subject);
    const [sent, received] = await Promise.all([
      ctx.db
        .query("trades")
        .withIndex("by_sender", (q) => q.eq("senderId", user._id))
        .order("desc")
        .take(50),
      ctx.db
        .query("trades")
        .withIndex("by_receiver", (q) => q.eq("receiverId", user._id))
        .order("desc")
        .take(50)
    ]);
    const trades = [...new Map([...sent, ...received].map((trade) => [trade._id, trade])).values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 50);
    return await Promise.all(trades.map((trade) => hydrateTrade(ctx, trade)));
  }
});

export const get = internalQuery({
  args: { subject: v.string(), tradeId: v.string() },
  returns: tradeResponseValidator,
  handler: async (ctx, args) => {
    const user = await requireUserBySubject(ctx, args.subject);
    const trade = await tradeByStringId(ctx, args.tradeId);
    if (!trade || !isParticipant(trade, user._id)) throw notFound();
    return await hydrateTrade(ctx, trade);
  }
});

export const create = internalMutation({
  args: {
    subject: v.string(),
    receiverId: v.string(),
    message: v.optional(v.string()),
    senderCards: v.array(tradeCardInputValidator),
    receiverCards: v.array(tradeCardInputValidator)
  },
  returns: tradeResponseValidator,
  handler: async (ctx, args) => {
    const [sender, receiver] = await Promise.all([
      requireUserBySubject(ctx, args.subject),
      ctx.db
        .query("users")
        .withIndex("by_auth_subject", (q) => q.eq("authSubject", args.receiverId))
        .unique()
    ]);
    if (!receiver) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Trade receiver not found" });
    }
    if (receiver._id === sender._id) throw badRequest("You cannot trade with yourself");
    if (args.senderCards.length < 1) throw badRequest("At least one sender card is required");
    if (args.senderCards.length + args.receiverCards.length > 100) {
      throw badRequest("A trade cannot contain more than 100 card lines");
    }
    for (const card of [...args.senderCards, ...args.receiverCards]) {
      if (!Number.isInteger(card.quantity) || card.quantity < 1) {
        throw badRequest("Trade card quantity must be a positive integer");
      }
      if (card.estimatedValue !== undefined && !Number.isFinite(card.estimatedValue)) {
        throw badRequest("Trade card estimated value must be finite");
      }
    }

    const timestamp = Date.now();
    const tradeId = await ctx.db.insert("trades", {
      senderId: sender._id,
      receiverId: receiver._id,
      status: "pending",
      message: args.message,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    for (const [side, cards] of [
      ["sender", args.senderCards],
      ["receiver", args.receiverCards]
    ] as const) {
      for (const card of cards) {
        await ctx.db.insert("tradeCards", { tradeId, side, ...card });
      }
    }
    const trade = await ctx.db.get(tradeId);
    if (!trade) throw new Error("Created trade is missing");
    return await hydrateTrade(ctx, trade);
  }
});

export const setStatus = internalMutation({
  args: {
    subject: v.string(),
    tradeId: v.string(),
    status: v.union(v.literal("accepted"), v.literal("declined"), v.literal("cancelled"))
  },
  returns: tradeResponseValidator,
  handler: async (ctx, args) => {
    const user = await requireUserBySubject(ctx, args.subject);
    const trade = await tradeByStringId(ctx, args.tradeId);
    if (!trade || !isParticipant(trade, user._id)) throw notFound();
    if (trade.status !== "pending") {
      throw badRequest(`Trade is already ${trade.status}`);
    }
    if (args.status === "cancelled" && trade.senderId !== user._id) {
      throw forbidden("Only the sender can cancel a trade");
    }
    if (args.status !== "cancelled" && trade.receiverId !== user._id) {
      throw forbidden(`Only the receiver can ${args.status === "accepted" ? "accept" : "decline"} a trade`);
    }
    await ctx.db.patch(trade._id, { status: args.status, updatedAt: Date.now() });
    const updated = await ctx.db.get(trade._id);
    if (!updated) throw notFound();
    return await hydrateTrade(ctx, updated);
  }
});

export const remove = internalMutation({
  args: { subject: v.string(), tradeId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUserBySubject(ctx, args.subject);
    const trade = await tradeByStringId(ctx, args.tradeId);
    if (!trade || trade.senderId !== user._id) throw notFound();
    const cards = await ctx.db
      .query("tradeCards")
      .withIndex("by_trade", (q) => q.eq("tradeId", trade._id))
      .take(100);
    for (const card of cards) await ctx.db.delete(card._id);
    await ctx.db.delete(trade._id);
    return null;
  }
});

function cardKey(card: { tcg: string; externalId: string }) {
  return `${card.tcg}:${card.externalId}`;
}

function uniqueMatchCards(cards: MatchCard[]) {
  return [...new Map(cards.map((card) => [cardKey(card), card])).values()];
}

async function collectionCardsForUser(ctx: QueryCtx, userId: Id<"users">, limit: number) {
  const entries = await ctx.db
    .query("collectionEntries")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(limit);
  const cards = await Promise.all(entries.map((entry) => ctx.db.get(entry.cardId)));
  return cards.filter((card): card is Doc<"cards"> => card !== null);
}

export const findMatches = internalQuery({
  args: { subject: v.string() },
  returns: v.array(tradeMatchValidator),
  handler: async (ctx, args) => {
    const user = await requireUserBySubject(ctx, args.subject);
    const [wishlists, userCollection, sampledWishlistCards] = await Promise.all([
      ctx.db
        .query("wishlists")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .take(20),
      collectionCardsForUser(ctx, user._id, 1_000),
      ctx.db.query("wishlistCards").take(500)
    ]);
    const wantedCards = (
      await Promise.all(
        wishlists.map((wishlist) =>
          ctx.db
            .query("wishlistCards")
            .withIndex("by_wishlist", (q) => q.eq("wishlistId", wishlist._id))
            .take(100)
        )
      )
    ).flat();
    const wantSet = new Set(wantedCards.map(cardKey));
    const haveSet = new Set(userCollection.map(cardKey));
    const sampledWishlists = await Promise.all(
      sampledWishlistCards.map((card) => ctx.db.get(card.wishlistId))
    );
    const candidates = new Map<Id<"users">, { youHave: MatchCard[] }>();

    for (let index = 0; index < sampledWishlistCards.length; index += 1) {
      const card = sampledWishlistCards[index]!;
      const wishlist = sampledWishlists[index];
      if (!wishlist || wishlist.userId === user._id || !haveSet.has(cardKey(card))) continue;
      const candidate = candidates.get(wishlist.userId) ?? { youHave: [] };
      candidate.youHave.push({ externalId: card.externalId, tcg: card.tcg, name: card.name });
      candidates.set(wishlist.userId, candidate);
    }

    const matches = await Promise.all(
      [...candidates.entries()].slice(0, 15).map(async ([otherUserId, candidate]) => {
        const [otherUser, theirCollection] = await Promise.all([
          ctx.db.get(otherUserId),
          collectionCardsForUser(ctx, otherUserId, 300)
        ]);
        const theyHave = uniqueMatchCards(
          theirCollection
            .filter((card) => wantSet.has(cardKey(card)))
            .map((card) => ({
              externalId: card.externalId,
              tcg: card.tcg,
              name: card.name
            }))
        );
        const youHave = uniqueMatchCards(candidate.youHave);
        return {
          userId: otherUser?.authSubject ?? String(otherUserId),
          username: otherUser?.username,
          theyHave,
          youHave,
          matchScore: theyHave.length + youHave.length
        };
      })
    );
    return matches.sort((left, right) => right.matchScore - left.matchScore).slice(0, 20);
  }
});
