import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx
} from "./_generated/server";
import { tcgCodeValidator } from "./lib/validators";
import { internal } from "./_generated/api";
import { appendCollectionAudit, snapshotAuditEntries } from "./lib/collectionAudit";
import { insertNotification } from "./notifications";

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
  estimatedValue: v.optional(v.number()),
  collectionEntryId: v.optional(v.id("collectionEntries"))
});

const tradeCardResponseValidator = v.object({
  id: v.string(),
  side: v.union(v.literal("sender"), v.literal("receiver")),
  externalId: v.string(),
  tcg: v.string(),
  name: v.string(),
  quantity: v.number(),
  imageUrl: v.optional(v.string()),
  estimatedValue: v.optional(v.number()),
  collectionEntryId: v.optional(v.string()),
  reservedQuantity: v.number()
});

const tradeResponseValidator = v.object({
  id: v.string(),
  senderId: v.string(),
  receiverId: v.string(),
  status: tradeStatusValidator,
  message: v.optional(v.string()),
  settlementStatus: v.union(
    v.literal("unreserved"),
    v.literal("reserved"),
    v.literal("settled"),
    v.literal("released")
  ),
  settledAt: v.optional(v.string()),
  settlementId: v.optional(v.string()),
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

const MAX_TRADE_CARD_LINES = 100;
const MAX_TRADE_COPIES = 200;

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
  const [sender, receiver, cards, reservations] = await Promise.all([
    ctx.db.get(trade.senderId),
    ctx.db.get(trade.receiverId),
    ctx.db
      .query("tradeCards")
      .withIndex("by_trade", (q) => q.eq("tradeId", trade._id))
      .take(100),
    ctx.db
      .query("tradeReservations")
      .withIndex("by_trade", (q) => q.eq("tradeId", trade._id))
      .take(200)
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
      estimatedValue: card.estimatedValue,
      collectionEntryId: card.collectionEntryId ? String(card.collectionEntryId) : undefined,
      reservedQuantity: reservations
        .filter((reservation) =>
          reservation.tradeCardId === card._id && reservation.status === "reserved"
        )
        .reduce((sum, reservation) => sum + reservation.quantity, 0)
    })),
    settlementStatus: trade.settlementStatus ?? "unreserved",
    settledAt: trade.settledAt ? new Date(trade.settledAt).toISOString() : undefined,
    settlementId: trade.settlementId,
    createdAt: new Date(trade.createdAt).toISOString(),
    updatedAt: new Date(trade.updatedAt).toISOString()
  };
}

function isParticipant(trade: Doc<"trades">, userId: Id<"users">) {
  return trade.senderId === userId || trade.receiverId === userId;
}

async function allocateOwnedEntries(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  card: {
    tcg: Doc<"cards">["tcg"];
    externalId: string;
    quantity: number;
    collectionEntryId?: Id<"collectionEntries">;
  }
) {
  const canonical = await ctx.db
    .query("cards")
    .withIndex("by_tcg_external", (q) =>
      q.eq("tcg", card.tcg).eq("externalId", card.externalId)
    )
    .unique();
  if (!canonical) throw badRequest(`Card ${card.externalId} is not in the local catalog`);
  const entries = await ctx.db
    .query("collectionEntries")
    .withIndex("by_user_card", (q) =>
      q.eq("userId", ownerId).eq("cardId", canonical._id)
    )
    .take(1_000);
  const exactEntry = card.collectionEntryId
    ? entries.find((entry) => entry._id === card.collectionEntryId)
    : undefined;
  if (card.collectionEntryId && !exactEntry) {
    throw new ConvexError({
      code: "CONFLICT",
      message: `The selected copy of ${card.externalId} is not available to this trader`
    });
  }
  const ordered = exactEntry
    ? [exactEntry]
    : [...entries].sort((left, right) => left.createdAt - right.createdAt);
  let remaining = card.quantity;
  const allocations: Array<{ entry: Doc<"collectionEntries">; quantity: number }> = [];
  for (const entry of ordered) {
    const reservations = await ctx.db
      .query("tradeReservations")
      .withIndex("by_entry_and_status", (q) =>
        q.eq("collectionEntryId", entry._id).eq("status", "reserved")
      )
      .take(501);
    if (reservations.length > 500) {
      throw new ConvexError({
        code: "LIMIT_EXCEEDED",
        message: "This collection entry has too many active trade reservations"
      });
    }
    const available = Math.max(
      0,
      entry.quantity - reservations.reduce((sum, reservation) => sum + reservation.quantity, 0)
    );
    const quantity = Math.min(remaining, available);
    if (quantity > 0) allocations.push({ entry, quantity });
    remaining -= quantity;
    if (remaining === 0) break;
  }
  if (remaining > 0) {
    throw new ConvexError({
      code: "CONFLICT",
      message: `Not enough unreserved copies of ${card.externalId} are available`
    });
  }
  return allocations;
}

async function reserveTradeCard(
  ctx: MutationCtx,
  tradeId: Id<"trades">,
  tradeCardId: Id<"tradeCards">,
  ownerId: Id<"users">,
  card: {
    tcg: Doc<"cards">["tcg"];
    externalId: string;
    quantity: number;
    collectionEntryId?: Id<"collectionEntries">;
  }
) {
  const allocations = await allocateOwnedEntries(ctx, ownerId, card);
  const now = Date.now();
  for (const allocation of allocations) {
    await ctx.db.insert("tradeReservations", {
      tradeId,
      tradeCardId,
      ownerId,
      collectionEntryId: allocation.entry._id,
      quantity: allocation.quantity,
      status: "reserved",
      createdAt: now,
      updatedAt: now
    });
  }
}

async function releaseReservations(ctx: MutationCtx, tradeId: Id<"trades">) {
  const reservations = await ctx.db
    .query("tradeReservations")
    .withIndex("by_trade", (q) => q.eq("tradeId", tradeId))
    .take(200);
  const now = Date.now();
  for (const reservation of reservations) {
    if (reservation.status === "reserved") {
      await ctx.db.patch(reservation._id, { status: "released", updatedAt: now });
    }
  }
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
    if (args.senderCards.length + args.receiverCards.length > MAX_TRADE_CARD_LINES) {
      throw badRequest(`A trade cannot contain more than ${MAX_TRADE_CARD_LINES} card lines`);
    }
    const totalCopies = [...args.senderCards, ...args.receiverCards]
      .reduce((sum, card) => sum + card.quantity, 0);
    if (totalCopies > MAX_TRADE_COPIES) {
      throw badRequest(`A trade cannot contain more than ${MAX_TRADE_COPIES} total copies`);
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
      settlementStatus: "unreserved",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    for (const [side, cards] of [
      ["sender", args.senderCards],
      ["receiver", args.receiverCards]
    ] as const) {
      for (const card of cards) {
        const tradeCardId = await ctx.db.insert("tradeCards", { tradeId, side, ...card });
        if (side === "sender") {
          await reserveTradeCard(ctx, tradeId, tradeCardId, sender._id, card);
        }
      }
    }
    await ctx.db.patch(tradeId, { settlementStatus: "reserved", updatedAt: Date.now() });
    const trade = await ctx.db.get(tradeId);
    if (!trade) throw new Error("Created trade is missing");
    return await hydrateTrade(ctx, trade);
  }
});

async function ensureLibraryBinder(
  ctx: MutationCtx,
  userId: Id<"users">
) {
  const existing = await ctx.db
    .query("binders")
    .withIndex("by_user_kind", (q) =>
      q.eq("userId", userId).eq("kind", "library")
    )
    .first();
  if (existing) return existing._id;
  const now = Date.now();
  return await ctx.db.insert("binders", {
    userId,
    kind: "library",
    name: "Library",
    createdAt: now,
    updatedAt: now
  });
}

async function consumeStoragePlacements(
  ctx: MutationCtx,
  entryId: Id<"collectionEntries">,
  quantity: number
) {
  const placements = await ctx.db
    .query("storagePlacements")
    .withIndex("by_entry", (q) => q.eq("collectionEntryId", entryId))
    .take(100);
  let remaining = quantity;
  for (const placement of placements) {
    if (remaining <= 0) break;
    const consumed = Math.min(remaining, placement.quantity);
    if (consumed === placement.quantity) await ctx.db.delete(placement._id);
    else {
      await ctx.db.patch(placement._id, {
        quantity: placement.quantity - consumed,
        updatedAt: Date.now()
      });
    }
    remaining -= consumed;
  }
}

async function transferReservedEntry(
  ctx: MutationCtx,
  reservation: Doc<"tradeReservations">,
  recipientId: Id<"users">,
  recipientBinderId: Id<"binders">
) {
  const source = await ctx.db.get(reservation.collectionEntryId);
  if (
    !source ||
    source.userId !== reservation.ownerId ||
    source.quantity < reservation.quantity
  ) {
    throw new ConvexError({
      code: "CONFLICT",
      message: "A reserved collection copy is no longer available"
    });
  }
  const now = Date.now();
  await consumeStoragePlacements(ctx, source._id, reservation.quantity);
  if (source.quantity === reservation.quantity) {
    const tags = await ctx.db
      .query("collectionEntryTags")
      .withIndex("by_entry", (q) => q.eq("entryId", source._id))
      .take(100);
    for (const tag of tags) await ctx.db.delete(tag._id);
    await ctx.db.delete(source._id);
  } else {
    await ctx.db.patch(source._id, {
      quantity: source.quantity - reservation.quantity,
      updatedAt: now
    });
  }
  const incomingId = await ctx.db.insert("collectionEntries", {
    userId: recipientId,
    binderId: recipientBinderId,
    cardId: source.cardId,
    quantity: reservation.quantity,
    condition: source.condition,
    language: source.language,
    notes: source.notes,
    price: source.price,
    serialNumber: reservation.quantity === 1 ? source.serialNumber : undefined,
    acquiredAt: new Date(now).toISOString(),
    isFoil: source.isFoil,
    finishCode: source.finishCode,
    finishLabel: source.finishLabel,
    edition: source.edition,
    stamp: source.stamp,
    isSealedPromo: source.isSealedPromo,
    isOversized: source.isOversized,
    isPeelOff: source.isPeelOff,
    isSigned: source.isSigned,
    isAltered: source.isAltered,
    gradingCompany: source.gradingCompany,
    gradingScore: source.gradingScore,
    certNumber: reservation.quantity === 1 ? source.certNumber : undefined,
    imageUrls: source.imageUrls,
    imageStorageIds: source.imageStorageIds,
    createdAt: now,
    updatedAt: now
  });
  await ctx.db.patch(reservation._id, { status: "settled", updatedAt: now });
  return incomingId;
}

async function incrementTradeSummary(
  ctx: MutationCtx,
  userId: Id<"users">,
  now: number
) {
  const summary = await ctx.db
    .query("financeSummaries")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (summary) {
    await ctx.db.patch(summary._id, {
      transactionCount: summary.transactionCount + 1,
      updatedAt: now
    });
  } else {
    await ctx.db.insert("financeSummaries", {
      userId,
      totalSpent: 0,
      totalEarned: 0,
      transactionCount: 1,
      updatedAt: now
    });
  }
}

async function settleTrade(
  ctx: MutationCtx,
  trade: Doc<"trades">,
  actorSubject: string
) {
  const cards = await ctx.db
    .query("tradeCards")
    .withIndex("by_trade", (q) => q.eq("tradeId", trade._id))
    .take(100);
  for (const card of cards.filter((item) => item.side === "receiver")) {
    await reserveTradeCard(ctx, trade._id, card._id, trade.receiverId, card);
  }
  const reservations = await ctx.db
    .query("tradeReservations")
    .withIndex("by_trade", (q) => q.eq("tradeId", trade._id))
    .take(200);
  const active = reservations.filter((reservation) => reservation.status === "reserved");
  const senderEntryIds = active
    .filter((reservation) => reservation.ownerId === trade.senderId)
    .map((reservation) => reservation.collectionEntryId);
  const receiverEntryIds = active
    .filter((reservation) => reservation.ownerId === trade.receiverId)
    .map((reservation) => reservation.collectionEntryId);
  const [senderBefore, receiverBefore, senderBinderId, receiverBinderId] = await Promise.all([
    snapshotAuditEntries(ctx, trade.senderId, senderEntryIds),
    snapshotAuditEntries(ctx, trade.receiverId, receiverEntryIds),
    ensureLibraryBinder(ctx, trade.senderId),
    ensureLibraryBinder(ctx, trade.receiverId)
  ]);
  const senderIncoming: Id<"collectionEntries">[] = [];
  const receiverIncoming: Id<"collectionEntries">[] = [];
  for (const reservation of active) {
    if (reservation.ownerId === trade.senderId) {
      receiverIncoming.push(
        await transferReservedEntry(ctx, reservation, trade.receiverId, receiverBinderId)
      );
    } else {
      senderIncoming.push(
        await transferReservedEntry(ctx, reservation, trade.senderId, senderBinderId)
      );
    }
  }
  const [senderAfter, receiverAfter] = await Promise.all([
    snapshotAuditEntries(ctx, trade.senderId, [
      ...new Set([...senderEntryIds, ...senderIncoming])
    ]),
    snapshotAuditEntries(ctx, trade.receiverId, [
      ...new Set([...receiverEntryIds, ...receiverIncoming])
    ])
  ]);
  const settlementId = `trade_${trade._id}_${Date.now()}`;
  const now = Date.now();
  const senderReceivedValue = cards
    .filter((card) => card.side === "receiver")
    .reduce((sum, card) => sum + (card.estimatedValue ?? 0) * card.quantity, 0);
  const receiverReceivedValue = cards
    .filter((card) => card.side === "sender")
    .reduce((sum, card) => sum + (card.estimatedValue ?? 0) * card.quantity, 0);
  const senderReceivedQuantity = cards
    .filter((card) => card.side === "receiver")
    .reduce((sum, card) => sum + card.quantity, 0);
  const receiverReceivedQuantity = cards
    .filter((card) => card.side === "sender")
    .reduce((sum, card) => sum + card.quantity, 0);
  await ctx.db.insert("transactions", {
    userId: trade.senderId,
    type: "trade",
    quantity: Math.max(1, senderReceivedQuantity),
    amount: senderReceivedValue,
    currency: "USD",
    allocationGroupId: settlementId,
    relatedTradeId: trade._id,
    notes: `Atomic settlement for trade ${trade._id}`,
    date: now,
    createdAt: now,
    updatedAt: now
  });
  await ctx.db.insert("transactions", {
    userId: trade.receiverId,
    type: "trade",
    quantity: Math.max(1, receiverReceivedQuantity),
    amount: receiverReceivedValue,
    currency: "USD",
    allocationGroupId: settlementId,
    relatedTradeId: trade._id,
    notes: `Atomic settlement for trade ${trade._id}`,
    date: now,
    createdAt: now,
    updatedAt: now
  });
  await Promise.all([
    incrementTradeSummary(ctx, trade.senderId, now),
    incrementTradeSummary(ctx, trade.receiverId, now),
    appendCollectionAudit(ctx, {
      userId: trade.senderId,
      actorId: actorSubject,
      operationKind: "trade_settlement",
      summary: `Settled trade ${trade._id}`,
      before: senderBefore,
      after: senderAfter,
      idempotencyKey: `${settlementId}:sender`
    }),
    appendCollectionAudit(ctx, {
      userId: trade.receiverId,
      actorId: actorSubject,
      operationKind: "trade_settlement",
      summary: `Settled trade ${trade._id}`,
      before: receiverBefore,
      after: receiverAfter,
      idempotencyKey: `${settlementId}:receiver`
    })
  ]);
  await ctx.db.patch(trade._id, {
    status: "accepted",
    settlementStatus: "settled",
    settlementId,
    settledAt: now,
    updatedAt: now
  });
  for (const [userId, title] of [
    [trade.senderId, "Trade settled"],
    [trade.receiverId, "Trade accepted and settled"]
  ] as const) {
    const notificationId = await insertNotification(ctx, {
      userId,
      type: "trade_settlement",
      title,
      body: "Reserved copies were moved and finance activity was recorded.",
      data: { tradeId: String(trade._id), settlementId }
    });
    await ctx.scheduler.runAfter(0, internal.notifications.dispatchNotification, {
      notificationId
    });
  }
  return (await ctx.db.get(trade._id))!;
}

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
    const updated = args.status === "accepted"
      ? await settleTrade(ctx, trade, user.authSubject)
      : await (async () => {
          await releaseReservations(ctx, trade._id);
          await ctx.db.patch(trade._id, {
            status: args.status,
            settlementStatus: "released",
            updatedAt: Date.now()
          });
          return await ctx.db.get(trade._id);
        })();
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
    if (trade.settlementStatus === "settled") {
      throw badRequest("Settled trades are retained as immutable audit records");
    }
    const cards = await ctx.db
      .query("tradeCards")
      .withIndex("by_trade", (q) => q.eq("tradeId", trade._id))
      .take(100);
    await releaseReservations(ctx, trade._id);
    const reservations = await ctx.db
      .query("tradeReservations")
      .withIndex("by_trade", (q) => q.eq("tradeId", trade._id))
      .take(200);
    for (const reservation of reservations) await ctx.db.delete(reservation._id);
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
