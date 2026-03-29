import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { buildViewerResponse, requireIdentity, requireViewer } from "./lib/auth";
import { getLibraryBinder, now } from "./lib/domain";
import { viewerValidator } from "./lib/validators";

export const ensureCurrent = mutation({
  args: {
    username: v.optional(v.string()),
    name: v.optional(v.string())
  },
  returns: viewerValidator,
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_auth_subject", (q) => q.eq("authSubject", identity.subject))
      .unique();
    const timestamp = now();

    let userId = existing?._id;
    if (existing) {
      await ctx.db.patch(existing._id, {
        email: identity.email ?? existing.email,
        name: args.name ?? identity.name ?? existing.name,
        username: args.username ?? existing.username,
        updatedAt: timestamp
      });
    } else {
      userId = await ctx.db.insert("users", {
        authSubject: identity.subject,
        email: identity.email,
        name: args.name ?? identity.name,
        username: args.username,
        isAdmin: false,
        showCardNumbers: true,
        showPricing: true,
        enabledYugioh: true,
        enabledMagic: true,
        enabledPokemon: true,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }

    const library = await getLibraryBinder(ctx, userId!);
    if (!library) {
      await ctx.db.insert("binders", {
        userId: userId!,
        kind: "library",
        name: "Library",
        description: "Default cross-game library",
        colorHex: "0f172a",
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }

    const viewer = await requireViewer(ctx);
    return await buildViewerResponse(ctx, viewer);
  }
});

export const me = query({
  args: {},
  returns: viewerValidator,
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    return await buildViewerResponse(ctx, viewer);
  }
});
