import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { tcgCodeValidator } from "./lib/validators";
import { insertNotification } from "./notifications";

type ReaderCtx = QueryCtx | MutationCtx;
const MAX_PRICE_ALERTS_PER_USER = 500;
const MAX_AUTOMATIONS_PER_USER = 200;

async function viewer(ctx: ReaderCtx, subject: string) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", subject))
    .unique();
  if (!user)
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Viewer not provisioned",
    });
  return user;
}

function notFound(message: string): never {
  throw new ConvexError({ code: "NOT_FOUND", message });
}

const alertValidator = v.object({
  id: v.id("priceAlerts"),
  externalId: v.string(),
  tcg: v.string(),
  cardName: v.string(),
  imageUrl: v.optional(v.string()),
  finishCode: v.optional(v.string()),
  targetPrice: v.number(),
  direction: v.string(),
  currency: v.string(),
  cooldownHours: v.number(),
  isActive: v.boolean(),
  lastTriggered: v.optional(v.string()),
  lastTriggeredPrice: v.optional(v.number()),
  lastObservedPrice: v.optional(v.number()),
  lastObservedAt: v.optional(v.string()),
  state: v.union(v.literal("unknown"), v.literal("matched"), v.literal("unmatched")),
  cooldownUntil: v.optional(v.string()),
  createdAt: v.string(),
});

function alertResponse(row: Doc<"priceAlerts">) {
  return {
    id: row._id,
    externalId: row.externalId,
    tcg: row.tcg,
    cardName: row.cardName ?? row.externalId,
    imageUrl: row.imageUrl,
    finishCode: row.finishCode,
    targetPrice: row.threshold,
    direction: row.direction,
    currency: row.currency,
    cooldownHours: row.cooldownHours ?? 24,
    isActive: row.enabled,
    lastTriggered: row.lastTriggeredAt
      ? new Date(row.lastTriggeredAt).toISOString()
      : undefined,
    lastTriggeredPrice: row.lastTriggeredPrice,
    lastObservedPrice: row.lastObservedPrice,
    lastObservedAt: row.lastObservedAt
      ? new Date(row.lastObservedAt).toISOString()
      : undefined,
    state: row.lastState ?? "unknown" as const,
    cooldownUntil: row.cooldownUntil
      ? new Date(row.cooldownUntil).toISOString()
      : undefined,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export const listAlerts = internalQuery({
  args: { subject: v.string() },
  returns: v.array(alertValidator),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const rows = await ctx.db
      .query("priceAlerts")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_PRICE_ALERTS_PER_USER);
    return rows.sort((a, b) => b.createdAt - a.createdAt).map(alertResponse);
  },
});

export const createAlert = internalMutation({
  args: {
    subject: v.string(),
    externalId: v.string(),
    tcg: tcgCodeValidator,
    cardName: v.string(),
    imageUrl: v.optional(v.string()),
    finishCode: v.optional(v.string()),
    targetPrice: v.number(),
    direction: v.union(v.literal("above"), v.literal("below")),
    currency: v.optional(v.string()),
    cooldownHours: v.optional(v.number()),
  },
  returns: alertValidator,
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const now = Date.now();
    const existing = await ctx.db.query("priceAlerts").withIndex("by_user_card_finish", (q) => q.eq("userId", user._id).eq("tcg", args.tcg).eq("externalId", args.externalId).eq("finishCode", args.finishCode)).first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        cardName: args.cardName, imageUrl: args.imageUrl, threshold: args.targetPrice, direction: args.direction,
        currency: (args.currency ?? existing.currency).toUpperCase(), cooldownHours: args.cooldownHours ?? existing.cooldownHours ?? 24,
        enabled: true, lastState: "unknown", cooldownUntil: 0, updatedAt: now,
      });
      return alertResponse((await ctx.db.get(existing._id))!);
    }
    const alertCount = await ctx.db
      .query("priceAlerts")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_PRICE_ALERTS_PER_USER);
    if (alertCount.length >= MAX_PRICE_ALERTS_PER_USER) {
      throw new ConvexError({
        code: "LIMIT_EXCEEDED",
        message: `Price alerts are limited to ${MAX_PRICE_ALERTS_PER_USER} per account`,
      });
    }
    const id = await ctx.db.insert("priceAlerts", {
      userId: user._id,
      tcg: args.tcg,
      externalId: args.externalId,
      cardName: args.cardName,
      imageUrl: args.imageUrl,
      finishCode: args.finishCode,
      direction: args.direction,
      threshold: args.targetPrice,
      currency: (args.currency ?? "USD").toUpperCase(),
      enabled: true,
      cooldownHours: args.cooldownHours ?? 24,
      lastState: "unknown",
      createdAt: now,
      updatedAt: now,
    });
    return alertResponse((await ctx.db.get(id))!);
  },
});

export const updateAlert = internalMutation({
  args: {
    subject: v.string(),
    alertId: v.id("priceAlerts"),
    targetPrice: v.optional(v.number()),
    direction: v.optional(v.union(v.literal("above"), v.literal("below"))),
    isActive: v.optional(v.boolean()),
    cooldownHours: v.optional(v.number()),
  },
  returns: alertValidator,
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const row = await ctx.db.get(args.alertId);
    if (!row || row.userId !== user._id) notFound("Alert not found");
    await ctx.db.patch(args.alertId, {
      threshold: args.targetPrice ?? row.threshold,
      direction: args.direction ?? row.direction,
      enabled: args.isActive ?? row.enabled,
      cooldownHours: args.cooldownHours ?? row.cooldownHours ?? 24,
      ...((args.targetPrice !== undefined || args.direction !== undefined)
        ? { lastState: "unknown" as const, cooldownUntil: 0 }
        : {}),
      updatedAt: Date.now(),
    });
    return alertResponse((await ctx.db.get(args.alertId))!);
  },
});

function snapshotPrice(
  snapshot: Doc<"cardPriceSnapshots">,
  currency: string,
) {
  if (
    snapshot.convertedPrice !== undefined &&
    snapshot.convertedCurrency?.toUpperCase() === currency
  ) {
    return snapshot.convertedPrice;
  }
  if (snapshot.nativeCurrency.toUpperCase() === currency) {
    return snapshot.nativePrice;
  }
  return undefined;
}

async function evaluateAlert(ctx: MutationCtx, alert: Doc<"priceAlerts">) {
  const latest = await ctx.db
    .query("cardPriceSnapshots")
    .withIndex("by_user_card_and_captured_at", (q) =>
      q
        .eq("userId", alert.userId)
        .eq("tcg", alert.tcg)
        .eq("externalId", alert.externalId)
        .eq("finishCode", alert.finishCode),
    )
    .order("desc")
    .first();
  const now = Date.now();
  if (!latest) {
    await ctx.db.patch(alert._id, {
      lastError: "No price snapshot is available yet",
      updatedAt: now,
    });
    return false;
  }
  const quoteTimestamp = latest.sourceUpdatedAt ?? latest.capturedAt;
  if (quoteTimestamp < now - 48 * 60 * 60 * 1_000) {
    await ctx.db.patch(alert._id, { lastError: "Latest price quote is stale", lastObservedAt: quoteTimestamp, updatedAt: now });
    return false;
  }
  if ((latest.matchConfidence ?? 1) < 0.8) {
    await ctx.db.patch(alert._id, { lastError: "Latest price match is low-confidence", lastObservedAt: quoteTimestamp, updatedAt: now });
    return false;
  }
  const currency = alert.currency.toUpperCase();
  const price = snapshotPrice(latest, currency);
  if (price === undefined) {
    await ctx.db.patch(alert._id, {
      lastError: `Latest quote is not available in ${currency}`,
      lastObservedAt: latest.capturedAt,
      updatedAt: now,
    });
    return false;
  }
  const matched = alert.direction === "below"
    ? price <= alert.threshold
    : price >= alert.threshold;
  const state = matched ? "matched" as const : "unmatched" as const;
  const canTrigger = !alert.cooldownUntil || alert.cooldownUntil <= now;
  const shouldTrigger = matched && alert.lastState !== "matched" && canTrigger;
  const cooldownHours = alert.cooldownHours ?? 24;
  await ctx.db.patch(alert._id, {
    lastObservedPrice: price,
    lastObservedAt: quoteTimestamp,
    lastState: state,
    lastError: "",
    ...(shouldTrigger
      ? {
          lastTriggeredAt: now,
          lastTriggeredPrice: price,
          cooldownUntil: now + cooldownHours * 60 * 60 * 1_000,
        }
      : {}),
    updatedAt: now,
  });
  if (!shouldTrigger) return false;
  const comparison = alert.direction === "below" ? "at or below" : "at or above";
  const notificationId = await insertNotification(ctx, {
    userId: alert.userId,
    type: "price_alert",
    title: `${alert.cardName ?? alert.externalId} price target reached`,
    body: `${currency} ${price.toFixed(2)} is ${comparison} your ${currency} ${alert.threshold.toFixed(2)} target.`,
    data: {
      alertId: String(alert._id),
      tcg: alert.tcg,
      externalId: alert.externalId,
      price,
      currency,
      threshold: alert.threshold,
      direction: alert.direction,
    },
  });
  await ctx.scheduler.runAfter(0, internal.notifications.dispatchNotification, {
    notificationId,
  });
  return true;
}

export const evaluateForSubject = internalMutation({
  args: { subject: v.string() },
  returns: v.object({ evaluated: v.number(), triggered: v.number() }),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const alerts = await ctx.db
      .query("priceAlerts")
      .withIndex("by_user_and_enabled", (q) =>
        q.eq("userId", user._id).eq("enabled", true),
      )
      .take(500);
    let triggered = 0;
    for (const alert of alerts) {
      if (await evaluateAlert(ctx, alert)) triggered += 1;
    }
    return { evaluated: alerts.length, triggered };
  },
});

export const evaluateEnabledPage = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ evaluated: v.number(), triggered: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args): Promise<{ evaluated: number; triggered: number; isDone: boolean }> => {
    const page = await ctx.db
      .query("priceAlerts")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .paginate({ cursor: args.cursor ?? null, numItems: 100 });
    let triggered = 0;
    for (const alert of page.page) {
      if (await evaluateAlert(ctx, alert)) triggered += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.alertsAutomations.evaluateEnabledPage, {
        cursor: page.continueCursor,
      });
    }
    return { evaluated: page.page.length, triggered, isDone: page.isDone };
  },
});

export const deleteAlert = internalMutation({
  args: { subject: v.string(), alertId: v.id("priceAlerts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const row = await ctx.db.get(args.alertId);
    if (!row || row.userId !== user._id) notFound("Alert not found");
    await ctx.db.delete(args.alertId);
    return null;
  },
});

const automationValidator = v.object({
  id: v.id("automations"),
  name: v.string(),
  trigger: v.string(),
  action: v.string(),
  config: v.record(v.string(), v.any()),
  enabled: v.boolean(),
  createdAt: v.string(),
  updatedAt: v.string(),
});

function splitKind(kind: string) {
  const [trigger = "schedule", action = "notify"] = kind.split(":");
  return { trigger, action };
}

function automationResponse(row: Doc<"automations">) {
  const { trigger, action } = splitKind(row.kind);
  return {
    id: row._id,
    name: row.name,
    trigger,
    action,
    config: row.configuration,
    enabled: row.enabled,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export const listAutomations = internalQuery({
  args: { subject: v.string() },
  returns: v.array(automationValidator),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const rows = await ctx.db
      .query("automations")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_AUTOMATIONS_PER_USER);
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(automationResponse);
  },
});

export const createAutomation = internalMutation({
  args: {
    subject: v.string(),
    name: v.string(),
    trigger: v.string(),
    action: v.string(),
    config: v.record(v.string(), v.any()),
    enabled: v.optional(v.boolean()),
  },
  returns: automationValidator,
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const now = Date.now();
    const automationCount = await ctx.db
      .query("automations")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_AUTOMATIONS_PER_USER);
    if (automationCount.length >= MAX_AUTOMATIONS_PER_USER) {
      throw new ConvexError({
        code: "LIMIT_EXCEEDED",
        message: `Automations are limited to ${MAX_AUTOMATIONS_PER_USER} per account`,
      });
    }
    const id = await ctx.db.insert("automations", {
      userId: user._id,
      kind: `${args.trigger}:${args.action}`,
      name: args.name,
      enabled: args.enabled ?? true,
      configuration: args.config,
      createdAt: now,
      updatedAt: now,
    });
    return automationResponse((await ctx.db.get(id))!);
  },
});

export const updateAutomation = internalMutation({
  args: {
    subject: v.string(),
    automationId: v.id("automations"),
    name: v.optional(v.string()),
    trigger: v.optional(v.string()),
    action: v.optional(v.string()),
    config: v.optional(v.record(v.string(), v.any())),
    enabled: v.optional(v.boolean()),
  },
  returns: automationValidator,
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const row = await ctx.db.get(args.automationId);
    if (!row || row.userId !== user._id) notFound("Automation not found");
    const previous = splitKind(row.kind);
    await ctx.db.patch(args.automationId, {
      name: args.name ?? row.name,
      kind: `${args.trigger ?? previous.trigger}:${args.action ?? previous.action}`,
      configuration: args.config ?? row.configuration,
      enabled: args.enabled ?? row.enabled,
      updatedAt: Date.now(),
    });
    return automationResponse((await ctx.db.get(args.automationId))!);
  },
});

export const deleteAutomation = internalMutation({
  args: { subject: v.string(), automationId: v.id("automations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const row = await ctx.db.get(args.automationId);
    if (!row || row.userId !== user._id) notFound("Automation not found");
    await ctx.db.delete(args.automationId);
    return null;
  },
});
