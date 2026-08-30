import { ConvexError, v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { tcgCodeValidator } from "./lib/validators";

const targetTypeValidator = v.union(v.literal("identity"), v.literal("printing"));
const actionValidator = v.union(v.literal("upsert"), v.literal("remove"));
const nullableString = v.union(v.string(), v.null());

const patchValidator = v.object({
  name: v.optional(v.string()),
  printedName: v.optional(nullableString),
  searchAliases: v.optional(v.array(v.string())),
  setCode: v.optional(nullableString),
  setName: v.optional(nullableString),
  rarity: v.optional(nullableString),
  collectorNumber: v.optional(nullableString),
  releasedAt: v.optional(nullableString),
  imageUrl: v.optional(nullableString),
  imageUrlSmall: v.optional(nullableString),
  language: v.optional(nullableString),
  artist: v.optional(nullableString),
  attributes: v.optional(v.record(v.string(), v.any()))
});

const correctionValidator = v.object({
  id: v.id("catalogCorrections"),
  tcg: tcgCodeValidator,
  targetType: targetTypeValidator,
  targetKey: v.string(),
  revision: v.number(),
  action: actionValidator,
  patch: v.optional(patchValidator),
  reason: v.string(),
  createdBy: v.id("users"),
  createdByLabel: v.optional(v.string()),
  createdAt: v.string()
});

type ReaderCtx = QueryCtx | MutationCtx;

async function requireViewerBySubject(ctx: ReaderCtx, subject: string) {
  const viewer = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (query) => query.eq("authSubject", subject))
    .unique();
  if (!viewer) {
    throw new ConvexError({ code: "UNAUTHORIZED", message: "Viewer not provisioned" });
  }
  return viewer;
}

async function requireAdminBySubject(ctx: ReaderCtx, subject: string) {
  const viewer = await requireViewerBySubject(ctx, subject);
  if (!viewer.isAdmin) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return viewer;
}

async function responseFor(ctx: ReaderCtx, correction: Doc<"catalogCorrections">) {
  const creator = await ctx.db.get(correction.createdBy);
  return {
    id: correction._id,
    tcg: correction.tcg,
    targetType: correction.targetType,
    targetKey: correction.targetKey,
    revision: correction.revision,
    action: correction.action,
    patch: correction.patch,
    reason: correction.reason,
    createdBy: correction.createdBy,
    createdByLabel: creator?.username ?? creator?.name ?? creator?.email,
    createdAt: new Date(correction.createdAt).toISOString()
  };
}

async function targetHistory(
  ctx: ReaderCtx,
  args: Pick<Doc<"catalogCorrections">, "tcg" | "targetType" | "targetKey">,
  limit = 100
) {
  return await ctx.db
    .query("catalogCorrections")
    .withIndex("by_tcg_target_and_revision", (query) =>
      query
        .eq("tcg", args.tcg)
        .eq("targetType", args.targetType)
        .eq("targetKey", args.targetKey)
    )
    .order("desc")
    .take(limit);
}

export const listEffective = internalQuery({
  args: { subject: v.string(), tcg: v.optional(tcgCodeValidator) },
  returns: v.array(correctionValidator),
  handler: async (ctx, args) => {
    await requireViewerBySubject(ctx, args.subject);
    const rows = args.tcg
      ? await ctx.db
          .query("catalogCorrections")
          .withIndex("by_tcg_and_created_at", (query) => query.eq("tcg", args.tcg!))
          .order("desc")
          .take(2001)
      : await ctx.db
          .query("catalogCorrections")
          .withIndex("by_created_at")
          .order("desc")
          .take(2001);
    if (rows.length > 2000) {
      throw new ConvexError({
        code: "LIMIT_EXCEEDED",
        message: "Catalog correction ledger exceeds the interactive read limit"
      });
    }
    const latest = new Map<string, Doc<"catalogCorrections">>();
    for (const row of rows) {
      const key = `${row.tcg}\u0000${row.targetType}\u0000${row.targetKey}`;
      if (!latest.has(key)) latest.set(key, row);
    }
    const effective = [...latest.values()].filter((row) => row.action === "upsert");
    return await Promise.all(effective.map((row) => responseFor(ctx, row)));
  }
});

export const listHistory = internalQuery({
  args: { subject: v.string(), limit: v.optional(v.number()) },
  returns: v.array(correctionValidator),
  handler: async (ctx, args) => {
    await requireAdminBySubject(ctx, args.subject);
    const limit = Math.min(200, Math.max(1, Math.trunc(args.limit ?? 50)));
    const rows = await ctx.db
      .query("catalogCorrections")
      .withIndex("by_created_at")
      .order("desc")
      .take(limit);
    return await Promise.all(rows.map((row) => responseFor(ctx, row)));
  }
});

export const create = internalMutation({
  args: {
    subject: v.string(),
    tcg: tcgCodeValidator,
    targetType: targetTypeValidator,
    targetKey: v.string(),
    patch: patchValidator,
    reason: v.string()
  },
  returns: correctionValidator,
  handler: async (ctx, args) => {
    const viewer = await requireAdminBySubject(ctx, args.subject);
    const targetKey = args.targetKey.trim();
    const reason = args.reason.trim();
    if (!targetKey || reason.length < 3 || Object.keys(args.patch).length === 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "A target, correction, and reason of at least three characters are required"
      });
    }
    const previous = (await targetHistory(ctx, { ...args, targetKey }, 1))[0];
    const id = await ctx.db.insert("catalogCorrections", {
      tcg: args.tcg,
      targetType: args.targetType,
      targetKey,
      revision: (previous?.revision ?? 0) + 1,
      action: "upsert",
      patch: args.patch,
      reason,
      createdBy: viewer._id,
      createdAt: Date.now()
    });
    return await responseFor(ctx, (await ctx.db.get(id))!);
  }
});

export const remove = internalMutation({
  args: {
    subject: v.string(),
    tcg: tcgCodeValidator,
    targetType: targetTypeValidator,
    targetKey: v.string(),
    reason: v.string()
  },
  returns: correctionValidator,
  handler: async (ctx, args) => {
    const viewer = await requireAdminBySubject(ctx, args.subject);
    const targetKey = args.targetKey.trim();
    const previous = (await targetHistory(ctx, { ...args, targetKey }, 1))[0];
    if (!previous || previous.action === "remove") {
      throw new ConvexError({ code: "NOT_FOUND", message: "No active correction found" });
    }
    const id = await ctx.db.insert("catalogCorrections", {
      tcg: args.tcg,
      targetType: args.targetType,
      targetKey,
      revision: previous.revision + 1,
      action: "remove",
      reason: args.reason.trim() || "Removed catalog correction",
      createdBy: viewer._id,
      createdAt: Date.now()
    });
    return await responseFor(ctx, (await ctx.db.get(id))!);
  }
});

export const rollback = internalMutation({
  args: {
    subject: v.string(),
    correctionId: v.id("catalogCorrections"),
    reason: v.optional(v.string())
  },
  returns: correctionValidator,
  handler: async (ctx, args) => {
    const viewer = await requireAdminBySubject(ctx, args.subject);
    const selected = await ctx.db.get(args.correctionId);
    if (!selected) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Correction revision not found" });
    }
    const history = await targetHistory(ctx, selected, 100);
    if (history[0]?._id !== selected._id) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "Only the latest correction revision can be rolled back"
      });
    }
    const prior = history[1];
    const id = await ctx.db.insert("catalogCorrections", {
      tcg: selected.tcg,
      targetType: selected.targetType,
      targetKey: selected.targetKey,
      revision: selected.revision + 1,
      action: prior?.action ?? "remove",
      patch: prior?.action === "upsert" ? prior.patch : undefined,
      reason: args.reason?.trim() || `Rolled back revision ${selected.revision}`,
      createdBy: viewer._id,
      createdAt: Date.now()
    });
    return await responseFor(ctx, (await ctx.db.get(id))!);
  }
});
