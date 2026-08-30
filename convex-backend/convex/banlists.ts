import { ConvexError, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { tcgCodeValidator } from "./lib/validators";

const formatValidator = v.union(
  v.literal("tcg"),
  v.literal("traditional"),
  v.literal("ocg"),
  v.literal("goat"),
);
const statusValidator = v.union(
  v.literal("forbidden"),
  v.literal("limited"),
  v.literal("semi-limited"),
);
const entryInputValidator = v.object({
  externalId: v.optional(v.string()),
  cardName: v.string(),
  normalizedName: v.string(),
  status: statusValidator,
  limit: v.number(),
  remarks: v.optional(v.string()),
});
const entryResponseValidator = entryInputValidator;
const snapshotResponseValidator = v.object({
  id: v.id("banlistSnapshots"),
  format: formatValidator,
  name: v.string(),
  effectiveDate: v.optional(v.string()),
  sourceUrl: v.string(),
  identitySourceUrl: v.optional(v.string()),
  syncedAt: v.string(),
  entries: v.array(entryResponseValidator),
});

type ReaderCtx = QueryCtx | MutationCtx;

async function requireViewer(ctx: ReaderCtx, subject: string) {
  const viewer = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (query) => query.eq("authSubject", subject))
    .unique();
  if (!viewer) throw new ConvexError({ code: "UNAUTHORIZED", message: "Viewer not provisioned" });
  return viewer;
}

async function currentSnapshot(ctx: ReaderCtx, format: string) {
  const rows = await ctx.db
    .query("banlistSnapshots")
    .withIndex("by_tcg_format_and_is_current", (query) =>
      query.eq("tcg", "yugioh").eq("format", format).eq("isCurrent", true),
    )
    .order("desc")
    .take(2);
  if (rows.length > 1) {
    throw new ConvexError({ code: "INVARIANT", message: `Multiple current ${format} banlists` });
  }
  return rows[0] ?? null;
}

async function responseFor(ctx: ReaderCtx, snapshot: Doc<"banlistSnapshots">) {
  const entries = await ctx.db
    .query("banlistEntries")
    .withIndex("by_snapshot", (query) => query.eq("snapshotId", snapshot._id))
    .take(2001);
  if (entries.length > 2000) {
    throw new ConvexError({ code: "LIMIT_EXCEEDED", message: "Banlist exceeds the interactive read limit" });
  }
  return {
    id: snapshot._id,
    format: snapshot.format as "tcg" | "traditional" | "ocg" | "goat",
    name: snapshot.name,
    effectiveDate: snapshot.effectiveDate,
    sourceUrl: snapshot.sourceUrl,
    identitySourceUrl: snapshot.identitySourceUrl,
    syncedAt: new Date(snapshot.syncedAt).toISOString(),
    entries: entries.map((entry) => ({
      externalId: entry.externalId,
      cardName: entry.cardName,
      normalizedName: entry.normalizedName,
      status: entry.status,
      limit: entry.limit,
      remarks: entry.remarks,
    })),
  };
}

export const listCurrent = internalQuery({
  args: { subject: v.string(), format: formatValidator },
  returns: v.union(snapshotResponseValidator, v.null()),
  handler: async (ctx, args) => {
    await requireViewer(ctx, args.subject);
    const snapshot = await currentSnapshot(ctx, args.format);
    return snapshot ? await responseFor(ctx, snapshot) : null;
  },
});

export const upsertSnapshot = internalMutation({
  args: {
    format: formatValidator,
    name: v.string(),
    effectiveDate: v.optional(v.string()),
    sourceUrl: v.string(),
    identitySourceUrl: v.optional(v.string()),
    contentHash: v.string(),
    entries: v.array(entryInputValidator),
  },
  returns: v.object({
    snapshotId: v.id("banlistSnapshots"),
    unchanged: v.boolean(),
    entryCount: v.number(),
  }),
  handler: async (ctx, args) => {
    if (!args.entries.length || args.entries.length > 2_000) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "A banlist must contain 1 to 2,000 entries" });
    }
    const current = await currentSnapshot(ctx, args.format);
    if (current?.contentHash === args.contentHash) {
      await ctx.db.patch(current._id, { syncedAt: Date.now() });
      return { snapshotId: current._id, unchanged: true, entryCount: args.entries.length };
    }
    if (current) await ctx.db.patch(current._id, { isCurrent: false });
    const syncedAt = Date.now();
    const snapshotId = await ctx.db.insert("banlistSnapshots", {
      tcg: "yugioh",
      format: args.format,
      name: args.name,
      effectiveDate: args.effectiveDate,
      sourceUrl: args.sourceUrl,
      identitySourceUrl: args.identitySourceUrl,
      contentHash: args.contentHash,
      isCurrent: true,
      syncedAt,
    });
    for (const entry of args.entries) {
      await ctx.db.insert("banlistEntries", {
        snapshotId,
        tcg: "yugioh",
        format: args.format,
        ...entry,
      });
    }
    return { snapshotId, unchanged: false, entryCount: args.entries.length };
  },
});

export async function currentClassicalBanlist(ctx: QueryCtx, format: string) {
  const normalized = format.toLowerCase();
  const resolved = normalized.includes("traditional")
    ? "traditional"
    : normalized.includes("ocg")
      ? "ocg"
      : normalized.includes("goat")
        ? "goat"
        : "tcg";
  const snapshot = await currentSnapshot(ctx, resolved);
  if (!snapshot) return null;
  const entries = await ctx.db
    .query("banlistEntries")
    .withIndex("by_snapshot", (query) => query.eq("snapshotId", snapshot._id))
    .take(2001);
  if (entries.length > 2000) return null;
  const cards: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.externalId) cards[entry.externalId] = entry.status;
    cards[`name:${entry.normalizedName}`] = entry.status;
  }
  return {
    type: "classical" as const,
    name: snapshot.name,
    effectiveDate: snapshot.effectiveDate,
    cards,
  };
}
