import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { tcgCodeValidator } from "./lib/validators";

const snapshotInputValidator = v.object({
  tcg: tcgCodeValidator,
  externalId: v.string(),
  finishCode: v.optional(v.string()),
  source: v.string(),
  provider: v.optional(v.string()),
  capturedAt: v.number(),
  sourceUpdatedAt: v.optional(v.number()),
  nativePrice: v.number(),
  nativeCurrency: v.string(),
  convertedPrice: v.optional(v.number()),
  convertedCurrency: v.optional(v.string()),
  fxRate: v.optional(v.number()),
  fxSource: v.optional(v.string()),
  fxAsOf: v.optional(v.string()),
  matchMethod: v.optional(v.string()),
  matchConfidence: v.optional(v.number()),
  providerProductId: v.optional(v.string()),
  language: v.optional(v.string()),
});

const moverValidator = v.object({
  externalId: v.string(),
  tcg: v.string(),
  name: v.string(),
  priceChange: v.number(),
  percentChange: v.number(),
  currentPrice: v.number(),
});

type ReaderCtx = QueryCtx | MutationCtx;

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

export const recordSnapshots = internalMutation({
  args: { subject: v.string(), snapshots: v.array(snapshotInputValidator) },
  returns: v.object({ recorded: v.number() }),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    if (args.snapshots.length < 1 || args.snapshots.length > 500) {
      throw new ConvexError({
        code: "LIMIT_EXCEEDED",
        message: "One to 500 price snapshots are required",
      });
    }
    let recorded = 0;
    for (const snapshot of args.snapshots) {
      const day = new Date(snapshot.capturedAt).toISOString().slice(0, 10);
      const existing = await ctx.db
        .query("cardPriceSnapshots")
        .withIndex("by_user_card_source_and_day", (q) =>
          q
            .eq("userId", user._id)
            .eq("tcg", snapshot.tcg)
            .eq("externalId", snapshot.externalId)
            .eq("finishCode", snapshot.finishCode)
            .eq("source", snapshot.source)
            .eq("day", day),
        )
        .unique();
      const value = {
        userId: user._id,
        tcg: snapshot.tcg,
        externalId: snapshot.externalId,
        finishCode: snapshot.finishCode,
        source: snapshot.source,
        capturedAt: snapshot.capturedAt,
        sourceUpdatedAt: snapshot.sourceUpdatedAt,
        day,
        nativePrice: snapshot.nativePrice,
        nativeCurrency: snapshot.nativeCurrency.toUpperCase(),
        convertedPrice: snapshot.convertedPrice,
        convertedCurrency: snapshot.convertedCurrency?.toUpperCase(),
        fxRate: snapshot.fxRate,
        fxSource: snapshot.fxSource,
        fxAsOf: snapshot.fxAsOf,
        matchMethod: snapshot.matchMethod,
        matchConfidence: snapshot.matchConfidence,
        createdAt: Date.now(),
      };
      if (existing) await ctx.db.patch(existing._id, value);
      else await ctx.db.insert("cardPriceSnapshots", value);
      recorded += 1;

      if (snapshot.providerProductId) {
        const card = await ctx.db
          .query("cards")
          .withIndex("by_tcg_external", (q) =>
            q.eq("tcg", snapshot.tcg).eq("externalId", snapshot.externalId),
          )
          .unique();
        if (card) {
          const crosswalkProvider = snapshot.provider ?? snapshot.source;
          const crosswalk = await ctx.db
            .query("providerProductCrosswalks")
            .withIndex("by_provider_and_provider_id", (q) =>
              q
                .eq("provider", crosswalkProvider)
                .eq("providerId", snapshot.providerProductId!),
            )
            .unique();
          const matchMethod =
            snapshot.matchMethod === "fuzzy" ? "fuzzy" : "exact";
          const crosswalkValue = {
            provider: crosswalkProvider,
            providerId: snapshot.providerProductId,
            cardId: card._id,
            language: snapshot.language,
            matchMethod: matchMethod as "exact" | "fuzzy",
            confidence: snapshot.matchConfidence ?? 1,
            sourceUpdatedAt: snapshot.sourceUpdatedAt ?? snapshot.capturedAt,
            updatedAt: Date.now(),
          };
          if (crosswalk) await ctx.db.patch(crosswalk._id, crosswalkValue);
          else
            await ctx.db.insert("providerProductCrosswalks", {
              ...crosswalkValue,
              createdAt: Date.now(),
            });
        }
      }
    }
    return { recorded };
  },
});

export const movers = internalQuery({
  args: {
    subject: v.string(),
    tcg: v.optional(tcgCodeValidator),
    periodDays: v.number(),
  },
  returns: v.object({
    gainers: v.array(moverValidator),
    losers: v.array(moverValidator),
  }),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const cutoff =
      Date.now() - Math.max(1, Math.min(365, args.periodDays)) * 86_400_000;
    const rows = await ctx.db
      .query("cardPriceSnapshots")
      .withIndex("by_user_and_captured_at", (q) =>
        q.eq("userId", user._id).gte("capturedAt", cutoff),
      )
      .take(5_001);
    if (rows.length > 5_000) {
      throw new ConvexError({
        code: "LIMIT_EXCEEDED",
        message: "Price analytics supports up to 5,000 snapshots in the requested period",
      });
    }
    const groups = new Map<string, Doc<"cardPriceSnapshots">[]>();
    for (const row of rows) {
      if (args.tcg && row.tcg !== args.tcg) continue;
      const key = `${row.tcg}:${row.externalId}:${row.finishCode ?? ""}:${row.source}:${row.nativeCurrency}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    const changes = [];
    for (const group of groups.values()) {
      group.sort((a, b) => a.capturedAt - b.capturedAt);
      const first = group[0];
      const last = group[group.length - 1];
      if (!first || !last || first._id === last._id || first.nativePrice <= 0)
        continue;
      const card = await ctx.db
        .query("cards")
        .withIndex("by_tcg_external", (q) =>
          q.eq("tcg", last.tcg).eq("externalId", last.externalId),
        )
        .unique();
      const priceChange = last.nativePrice - first.nativePrice;
      changes.push({
        externalId: last.externalId,
        tcg: last.tcg,
        name: card?.printedName ?? card?.name ?? last.externalId,
        priceChange,
        percentChange: (priceChange / first.nativePrice) * 100,
        currentPrice: last.nativePrice,
      });
    }
    const ordered = changes.sort((a, b) => b.percentChange - a.percentChange);
    return {
      gainers: ordered.filter((row) => row.priceChange > 0).slice(0, 10),
      losers: ordered
        .filter((row) => row.priceChange < 0)
        .reverse()
        .slice(0, 10),
    };
  },
});
