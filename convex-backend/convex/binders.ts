import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewer } from "./lib/auth";
import { hydrateBinderDetail, hydrateBinderSummary } from "./lib/library";
import { now, requireBinderForUser, validateColorHex, validateCondition } from "./lib/domain";
import {
  binderDetailValidator,
  binderSummaryValidator,
  tcgCodeValidator
} from "./lib/validators";

export const list = query({
  args: {},
  returns: v.array(binderSummaryValidator),
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const binders = await ctx.db
      .query("binders")
      .withIndex("by_user", (q) => q.eq("userId", viewer._id))
      .collect();
    const summaries = await Promise.all(binders.map((binder) => hydrateBinderSummary(ctx, binder)));
    return summaries.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "library" ? -1 : 1;
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }
});

export const get = query({
  args: {
    binderId: v.id("binders")
  },
  returns: binderDetailValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const binder = await requireBinderForUser(ctx, args.binderId, viewer._id);
    return await hydrateBinderDetail(ctx, binder);
  }
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    colorHex: v.optional(v.string()),
    defaultCondition: v.optional(v.string()),
    containerType: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    associatedTcg: v.optional(tcgCodeValidator),
    associatedSetCode: v.optional(v.string()),
    associatedSetName: v.optional(v.string())
  },
  returns: binderSummaryValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const timestamp = now();
    const binderId = await ctx.db.insert("binders", {
      userId: viewer._id,
      kind: "binder",
      name: args.name.trim(),
      description: args.description?.trim() || undefined,
      colorHex: validateColorHex(args.colorHex),
      defaultCondition: validateCondition(args.defaultCondition),
      containerType: args.containerType?.trim() || undefined,
      imageUrl: args.imageUrl?.trim() || undefined,
      associatedTcg: args.associatedTcg,
      associatedSetCode: args.associatedSetCode?.trim() || undefined,
      associatedSetName: args.associatedSetName?.trim() || undefined,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const binder = await requireBinderForUser(ctx, binderId, viewer._id);
    return await hydrateBinderSummary(ctx, binder);
  }
});
