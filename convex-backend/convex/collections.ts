import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewer } from "./lib/auth";
import { addEntryArgs, addEntryForViewer, hydrateBinderDetail, updateEntryArgs, updateEntryForViewer, removeEntryForViewer } from "./lib/library";
import { binderDetailValidator, entryValidator } from "./lib/validators";
import { requireBinderForUser } from "./lib/domain";

export const listForBinder = query({
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

export const addToBinder = mutation({
  args: addEntryArgs,
  returns: entryValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    return await addEntryForViewer(ctx, viewer._id, args);
  }
});

export const update = mutation({
  args: updateEntryArgs,
  returns: entryValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    return await updateEntryForViewer(ctx, viewer._id, args);
  }
});

export const remove = mutation({
  args: {
    entryId: v.id("collectionEntries")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    await removeEntryForViewer(ctx, viewer._id, args.entryId);
    return null;
  }
});
