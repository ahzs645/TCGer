import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

const transactionTypeValidator = v.union(
  v.literal("purchase"),
  v.literal("sale"),
  v.literal("trade"),
);

const transactionResponseValidator = v.object({
  id: v.id("transactions"),
  type: transactionTypeValidator,
  cardName: v.optional(v.string()),
  tcg: v.optional(v.string()),
  quantity: v.number(),
  amount: v.number(),
  currency: v.string(),
  platform: v.optional(v.string()),
  notes: v.optional(v.string()),
  date: v.string(),
});

const financeSummaryValidator = v.object({
  totalSpent: v.number(),
  totalEarned: v.number(),
  profitLoss: v.number(),
  transactionCount: v.number(),
});

type ReaderCtx = QueryCtx | MutationCtx;

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

function parseIsoDate(value: string, fieldName: string): number {
  const timestamp = Date.parse(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) ||
    !Number.isFinite(timestamp)
  ) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${fieldName} must be an ISO date-time`,
    });
  }
  return timestamp;
}

function toTransactionResponse(transaction: Doc<"transactions">) {
  return {
    id: transaction._id,
    type: transaction.type,
    cardName: transaction.cardName,
    tcg: transaction.tcg,
    quantity: transaction.quantity,
    amount: transaction.amount,
    currency: transaction.currency,
    platform: transaction.platform,
    notes: transaction.notes,
    date: new Date(transaction.date).toISOString(),
  };
}

async function updateSummary(
  ctx: MutationCtx,
  userId: Doc<"users">["_id"],
  transaction: Pick<Doc<"transactions">, "type" | "amount">,
  direction: 1 | -1,
) {
  const existing = await ctx.db
    .query("financeSummaries")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const spentDelta =
    transaction.type === "purchase" ? transaction.amount * direction : 0;
  const earnedDelta =
    transaction.type === "sale" ? transaction.amount * direction : 0;
  if (existing) {
    await ctx.db.patch(existing._id, {
      totalSpent: existing.totalSpent + spentDelta,
      totalEarned: existing.totalEarned + earnedDelta,
      transactionCount: existing.transactionCount + direction,
      updatedAt: Date.now(),
    });
    return;
  }
  await ctx.db.insert("financeSummaries", {
    userId,
    totalSpent: spentDelta,
    totalEarned: earnedDelta,
    transactionCount: direction,
    updatedAt: Date.now(),
  });
}

export const listTransactions = internalQuery({
  args: {
    subject: v.string(),
  },
  returns: v.array(transactionResponseValidator),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_user_and_date", (q) => q.eq("userId", viewer._id))
      .order("desc")
      .take(100);
    return transactions.map(toTransactionResponse);
  },
});

export const createTransaction = internalMutation({
  args: {
    subject: v.string(),
    type: transactionTypeValidator,
    cardId: v.optional(v.string()),
    externalId: v.optional(v.string()),
    tcg: v.optional(v.string()),
    cardName: v.optional(v.string()),
    quantity: v.optional(v.number()),
    amount: v.number(),
    currency: v.optional(v.string()),
    platform: v.optional(v.string()),
    notes: v.optional(v.string()),
    date: v.optional(v.string()),
  },
  returns: transactionResponseValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const quantity = args.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "quantity must be a positive integer",
      });
    }
    if (!Number.isFinite(args.amount)) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "amount must be a finite number",
      });
    }

    const timestamp = Date.now();
    const transactionId = await ctx.db.insert("transactions", {
      userId: viewer._id,
      type: args.type,
      cardId: args.cardId,
      externalId: args.externalId,
      tcg: args.tcg,
      cardName: args.cardName,
      quantity,
      amount: args.amount,
      currency: args.currency ?? "USD",
      platform: args.platform,
      notes: args.notes,
      date:
        args.date === undefined ? timestamp : parseIsoDate(args.date, "date"),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const transaction = await ctx.db.get(transactionId);
    if (!transaction) {
      throw new ConvexError({
        code: "INVARIANT",
        message: "Transaction could not be created",
      });
    }
    await updateSummary(ctx, viewer._id, transaction, 1);
    return toTransactionResponse(transaction);
  },
});

export const deleteTransaction = internalMutation({
  args: {
    subject: v.string(),
    transactionId: v.id("transactions"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const transaction = await ctx.db.get(args.transactionId);
    if (!transaction || transaction.userId !== viewer._id) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Transaction not found",
      });
    }
    await updateSummary(ctx, viewer._id, transaction, -1);
    await ctx.db.delete(transaction._id);
    return null;
  },
});

export const getSummary = internalQuery({
  args: {
    subject: v.string(),
  },
  returns: financeSummaryValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const summary = await ctx.db
      .query("financeSummaries")
      .withIndex("by_user", (q) => q.eq("userId", viewer._id))
      .unique();
    const totalSpent = summary?.totalSpent ?? 0;
    const totalEarned = summary?.totalEarned ?? 0;
    return {
      totalSpent: Math.round(totalSpent * 100) / 100,
      totalEarned: Math.round(totalEarned * 100) / 100,
      profitLoss: Math.round((totalEarned - totalSpent) * 100) / 100,
      transactionCount: summary?.transactionCount ?? 0,
    };
  },
});
