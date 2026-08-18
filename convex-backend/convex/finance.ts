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
  costBasis: v.optional(v.number()),
  fees: v.optional(v.number()),
  shippingCost: v.optional(v.number()),
  acquiredAt: v.optional(v.string()),
  netProceeds: v.optional(v.number()),
  realizedProfit: v.optional(v.number()),
  holdingDays: v.optional(v.number()),
  notes: v.optional(v.string()),
  date: v.string(),
});

const financeSummaryValidator = v.object({
  totalSpent: v.number(),
  totalEarned: v.number(),
  profitLoss: v.number(),
  transactionCount: v.number(),
});

const financeSummaryByCurrencyValidator = v.object({
  byCurrency: v.array(
    v.object({
      currency: v.string(),
      totalSpent: v.number(),
      totalEarned: v.number(),
      profitLoss: v.number(),
    }),
  ),
  transactionCount: v.number(),
});

const realizedSaleMetricValidator = v.object({
  id: v.id("transactions"),
  cardName: v.optional(v.string()),
  tcg: v.optional(v.string()),
  platform: v.optional(v.string()),
  currency: v.string(),
  quantity: v.number(),
  date: v.string(),
  revenue: v.number(),
  costBasis: v.optional(v.number()),
  fees: v.number(),
  shippingCost: v.number(),
  netProceeds: v.number(),
  realizedProfit: v.optional(v.number()),
  holdingDays: v.optional(v.number()),
});

const realizedPerformanceCurrencyValidator = v.object({
  currency: v.string(),
  revenue: v.number(),
  costBasis: v.number(),
  fees: v.number(),
  shippingCost: v.number(),
  netProceeds: v.number(),
  realizedProfit: v.number(),
  saleCount: v.number(),
  costedSaleCount: v.number(),
  averageHoldingDays: v.optional(v.number()),
});

const realizedPerformanceBreakdownValidator = v.object({
  key: v.string(),
  currency: v.string(),
  revenue: v.number(),
  realizedProfit: v.number(),
  saleCount: v.number(),
});

const realizedPerformanceValidator = v.object({
  byCurrency: v.array(realizedPerformanceCurrencyValidator),
  byPlatform: v.array(realizedPerformanceBreakdownValidator),
  byGame: v.array(realizedPerformanceBreakdownValidator),
  recentSales: v.array(realizedSaleMetricValidator),
  bestReturns: v.array(realizedSaleMetricValidator),
  worstReturns: v.array(realizedSaleMetricValidator),
  fastestSales: v.array(realizedSaleMetricValidator),
  inventoryCost: v.number(),
  inventoryMarketValue: v.number(),
  inventoryCurrency: v.string(),
  truncated: v.boolean(),
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
  const fees = transaction.fees ?? 0;
  const shippingCost = transaction.shippingCost ?? 0;
  const netProceeds = transaction.amount - fees - shippingCost;
  const holdingDays =
    transaction.acquiredAt === undefined
      ? undefined
      : Math.max(0, Math.floor((transaction.date - transaction.acquiredAt) / 86_400_000));
  return {
    id: transaction._id,
    type: transaction.type,
    cardName: transaction.cardName,
    tcg: transaction.tcg,
    quantity: transaction.quantity,
    amount: transaction.amount,
    currency: transaction.currency,
    platform: transaction.platform,
    costBasis: transaction.costBasis,
    fees: transaction.fees,
    shippingCost: transaction.shippingCost,
    acquiredAt:
      transaction.acquiredAt === undefined
        ? undefined
        : new Date(transaction.acquiredAt).toISOString(),
    netProceeds: transaction.type === "sale" ? roundMoney(netProceeds) : undefined,
    realizedProfit:
      transaction.type === "sale" && transaction.costBasis !== undefined
        ? roundMoney(netProceeds - transaction.costBasis)
        : undefined,
    holdingDays,
    notes: transaction.notes,
    date: new Date(transaction.date).toISOString(),
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function requireNonnegativeOptional(value: number | undefined, fieldName: string) {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${fieldName} must be zero or greater`,
    });
  }
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
    costBasis: v.optional(v.number()),
    fees: v.optional(v.number()),
    shippingCost: v.optional(v.number()),
    acquiredAt: v.optional(v.string()),
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
    if (!Number.isFinite(args.amount) || args.amount <= 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "amount must be greater than zero",
      });
    }
    requireNonnegativeOptional(args.costBasis, "costBasis");
    requireNonnegativeOptional(args.fees, "fees");
    requireNonnegativeOptional(args.shippingCost, "shippingCost");
    const currency = (args.currency ?? "USD").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "currency must be a three-letter ISO code",
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
      currency,
      platform: args.platform,
      costBasis: args.costBasis,
      fees: args.fees,
      shippingCost: args.shippingCost,
      acquiredAt:
        args.acquiredAt === undefined
          ? undefined
          : parseIsoDate(args.acquiredAt, "acquiredAt"),
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

export const getSummaryByCurrency = internalQuery({
  args: {
    subject: v.string(),
  },
  returns: financeSummaryByCurrencyValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_user_and_date", (q) => q.eq("userId", viewer._id))
      .order("desc")
      .take(5_000);
    const byCurrency = new Map<
      string,
      { totalSpent: number; totalEarned: number }
    >();
    for (const transaction of transactions) {
      const currency = transaction.currency.trim().toUpperCase();
      const totals = byCurrency.get(currency) ?? {
        totalSpent: 0,
        totalEarned: 0,
      };
      if (transaction.type === "purchase") {
        totals.totalSpent += transaction.amount;
      } else if (transaction.type === "sale") {
        totals.totalEarned += transaction.amount;
      }
      byCurrency.set(currency, totals);
    }
    return {
      byCurrency: [...byCurrency.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, totals]) => ({
          currency,
          totalSpent: Math.round(totals.totalSpent * 100) / 100,
          totalEarned: Math.round(totals.totalEarned * 100) / 100,
          profitLoss:
            Math.round((totals.totalEarned - totals.totalSpent) * 100) / 100,
        })),
      transactionCount: transactions.length,
    };
  },
});

export const getRealizedPerformance = internalQuery({
  args: {
    subject: v.string(),
    periodDays: v.optional(v.number()),
  },
  returns: realizedPerformanceValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const limit = 5_000;
    const rows = await ctx.db
      .query("transactions")
      .withIndex("by_user_and_date", (q) => q.eq("userId", viewer._id))
      .order("desc")
      .take(limit + 1);
    const cutoff =
      args.periodDays === undefined
        ? undefined
        : Date.now() - Math.max(1, Math.trunc(args.periodDays)) * 86_400_000;
    const sales = rows
      .slice(0, limit)
      .filter((row) => row.type === "sale" && (cutoff === undefined || row.date >= cutoff));
    const metrics = sales.map((sale) => {
      const fees = sale.fees ?? 0;
      const shippingCost = sale.shippingCost ?? 0;
      const netProceeds = roundMoney(sale.amount - fees - shippingCost);
      const holdingDays =
        sale.acquiredAt === undefined
          ? undefined
          : Math.max(0, Math.floor((sale.date - sale.acquiredAt) / 86_400_000));
      return {
        id: sale._id,
        cardName: sale.cardName,
        tcg: sale.tcg,
        platform: sale.platform,
        currency: sale.currency,
        quantity: sale.quantity,
        date: new Date(sale.date).toISOString(),
        revenue: roundMoney(sale.amount),
        costBasis: sale.costBasis,
        fees: roundMoney(fees),
        shippingCost: roundMoney(shippingCost),
        netProceeds,
        realizedProfit:
          sale.costBasis === undefined
            ? undefined
            : roundMoney(netProceeds - sale.costBasis),
        holdingDays,
      };
    });

    const currencyGroups = new Map<string, {
      revenue: number; costBasis: number; fees: number; shippingCost: number;
      netProceeds: number; realizedProfit: number; saleCount: number;
      costedSaleCount: number; holdingDays: number[];
    }>();
    for (const metric of metrics) {
      const group = currencyGroups.get(metric.currency) ?? {
        revenue: 0, costBasis: 0, fees: 0, shippingCost: 0,
        netProceeds: 0, realizedProfit: 0, saleCount: 0,
        costedSaleCount: 0, holdingDays: [],
      };
      group.revenue += metric.revenue;
      group.costBasis += metric.costBasis ?? 0;
      group.fees += metric.fees;
      group.shippingCost += metric.shippingCost;
      group.netProceeds += metric.netProceeds;
      group.saleCount += 1;
      if (metric.realizedProfit !== undefined) {
        group.realizedProfit += metric.realizedProfit;
        group.costedSaleCount += 1;
      }
      if (metric.holdingDays !== undefined) group.holdingDays.push(metric.holdingDays);
      currencyGroups.set(metric.currency, group);
    }

    const breakdown = (field: "platform" | "tcg") => {
      const groups = new Map<string, { key: string; currency: string; revenue: number; realizedProfit: number; saleCount: number }>();
      for (const metric of metrics) {
        const label = metric[field]?.trim() || "Unspecified";
        const mapKey = `${metric.currency}\u0000${label}`;
        const group = groups.get(mapKey) ?? { key: label, currency: metric.currency, revenue: 0, realizedProfit: 0, saleCount: 0 };
        group.revenue += metric.revenue;
        group.realizedProfit += metric.realizedProfit ?? 0;
        group.saleCount += 1;
        groups.set(mapKey, group);
      }
      return [...groups.values()]
        .map((group) => ({ ...group, revenue: roundMoney(group.revenue), realizedProfit: roundMoney(group.realizedProfit) }))
        .sort((left, right) => right.realizedProfit - left.realizedProfit);
    };

    const entries = await ctx.db
      .query("collectionEntries")
      .withIndex("by_user", (q) => q.eq("userId", viewer._id))
      .take(limit + 1);
    const inventory = entries.slice(0, limit).reduce(
      (total, entry) => ({
        cost: total.cost + (entry.acquisitionPrice ?? 0) * entry.quantity,
        market: total.market + (entry.price ?? 0) * entry.quantity,
      }),
      { cost: 0, market: 0 },
    );
    const costed = metrics.filter((metric) => metric.realizedProfit !== undefined);
    const withHolding = metrics.filter((metric) => metric.holdingDays !== undefined);

    return {
      byCurrency: [...currencyGroups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, group]) => ({
        currency,
        revenue: roundMoney(group.revenue),
        costBasis: roundMoney(group.costBasis),
        fees: roundMoney(group.fees),
        shippingCost: roundMoney(group.shippingCost),
        netProceeds: roundMoney(group.netProceeds),
        realizedProfit: roundMoney(group.realizedProfit),
        saleCount: group.saleCount,
        costedSaleCount: group.costedSaleCount,
        averageHoldingDays: group.holdingDays.length
          ? Math.round(group.holdingDays.reduce((sum, value) => sum + value, 0) / group.holdingDays.length)
          : undefined,
      })),
      byPlatform: breakdown("platform"),
      byGame: breakdown("tcg"),
      recentSales: metrics.slice(0, 8),
      bestReturns: [...costed].sort((a, b) => (b.realizedProfit ?? 0) - (a.realizedProfit ?? 0)).slice(0, 5),
      worstReturns: [...costed].sort((a, b) => (a.realizedProfit ?? 0) - (b.realizedProfit ?? 0)).slice(0, 5),
      fastestSales: [...withHolding].sort((a, b) => (a.holdingDays ?? 0) - (b.holdingDays ?? 0)).slice(0, 5),
      inventoryCost: roundMoney(inventory.cost),
      inventoryMarketValue: roundMoney(inventory.market),
      inventoryCurrency: "USD",
      truncated: rows.length > limit || entries.length > limit,
    };
  },
});
