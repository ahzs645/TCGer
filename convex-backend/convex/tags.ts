import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { requireViewer } from "./lib/auth";
import { now, validateColorHex } from "./lib/domain";
import { tagSummaryValidator } from "./lib/validators";

export const list = query({
  args: {},
  returns: v.array(tagSummaryValidator),
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_user", (q) => q.eq("userId", viewer._id))
      .collect();
    return tags
      .map((tag) => ({
        id: tag._id,
        label: tag.label,
        colorHex: tag.colorHex,
        createdAt: new Date(tag.createdAt).toISOString(),
        updatedAt: new Date(tag.updatedAt).toISOString()
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }
});

export const create = mutation({
  args: {
    label: v.string(),
    colorHex: v.optional(v.string())
  },
  returns: tagSummaryValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const label = args.label.trim();
    if (!label) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Tag label is required"
      });
    }
    const existing = await ctx.db
      .query("tags")
      .withIndex("by_user_label", (q) => q.eq("userId", viewer._id).eq("label", label))
      .unique();
    const timestamp = now();
    const colorHex = validateColorHex(args.colorHex) ?? "64748b";

    if (existing) {
      await ctx.db.patch(existing._id, { colorHex, updatedAt: timestamp });
      return {
        id: existing._id,
        label,
        colorHex,
        createdAt: new Date(existing.createdAt).toISOString(),
        updatedAt: new Date(timestamp).toISOString()
      };
    }

    const tagId = await ctx.db.insert("tags", {
      userId: viewer._id,
      label,
      colorHex,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    return {
      id: tagId,
      label,
      colorHex,
      createdAt: new Date(timestamp).toISOString(),
      updatedAt: new Date(timestamp).toISOString()
    };
  }
});
