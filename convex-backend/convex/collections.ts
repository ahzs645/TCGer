import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { requireViewer } from "./lib/auth";
import {
  addEntryArgs,
  addEntryForViewer,
  bulkAddDefaultsValidator,
  bulkAddForViewer,
  bulkAddResultValidator,
  bulkAddRowValidator,
  hydrateBinderDetail,
  updateEntryArgs,
  updateEntryForViewer,
  removeEntryForViewer
} from "./lib/library";
import { binderDetailValidator, entryValidator } from "./lib/validators";
import { requireBinderForUser } from "./lib/domain";
import {
  appendCollectionAudit,
  snapshotAuditEntries,
  undoAuditedCollectionMutation
} from "./lib/collectionAudit";
import { collectionMutationAuditEntryValidator } from "./lib/auditValidators";

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
    const quantity = args.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "quantity must be a positive integer"
      });
    }
    const entries: Awaited<ReturnType<typeof addEntryForViewer>>[] = [];
    for (let index = 0; index < quantity; index += 1) {
      entries.push(
        await addEntryForViewer(ctx, viewer._id, {
          ...args,
          quantity: 1
        })
      );
    }
    const entry = entries[0]!;
    const after = await snapshotAuditEntries(
      ctx,
      viewer._id,
      entries.map((created) => created.id)
    );
    await appendCollectionAudit(ctx, {
      userId: viewer._id,
      actorId: viewer.authSubject,
      operationKind: quantity > 1 ? "bulk" : "add",
      binderId: args.binderId,
      cardName: args.card.name,
      summary:
        quantity > 1
          ? `Added ${quantity} collection copies`
          : `Added ${args.card.name}`,
      before: [],
      after
    });
    return entry;
  }
});

export const bulkAdd = mutation({
  args: {
    defaults: v.optional(bulkAddDefaultsValidator),
    rows: v.array(bulkAddRowValidator)
  },
  returns: bulkAddResultValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    return await bulkAddForViewer(ctx, viewer._id, args);
  }
});

export const update = mutation({
  args: updateEntryArgs,
  returns: entryValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const before = await snapshotAuditEntries(ctx, viewer._id, [args.entryId]);
    const entry = await updateEntryForViewer(ctx, viewer._id, args);
    const after = await snapshotAuditEntries(ctx, viewer._id, [args.entryId]);
    const operationKind =
      args.binderId && before[0] && args.binderId !== before[0].binderId
        ? "move"
        : args.quantity !== undefined
          ? "bulk"
          : "update";
    await appendCollectionAudit(ctx, {
      userId: viewer._id,
      actorId: viewer.authSubject,
      operationKind,
      binderId: entry.binderId,
      cardName: entry.card.name,
      summary:
        operationKind === "move"
          ? `Moved ${entry.card.name}`
          : operationKind === "bulk"
            ? `Updated copies of ${entry.card.name}`
            : `Updated ${entry.card.name}`,
      before,
      after
    });
    return entry;
  }
});

export const remove = mutation({
  args: {
    entryId: v.id("collectionEntries")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const before = await snapshotAuditEntries(ctx, viewer._id, [args.entryId]);
    const card = before[0] ? await ctx.db.get(before[0].cardId) : null;
    await removeEntryForViewer(ctx, viewer._id, args.entryId);
    await appendCollectionAudit(ctx, {
      userId: viewer._id,
      actorId: viewer.authSubject,
      operationKind: "remove",
      binderId: before[0]?.binderId,
      cardName: card?.name,
      summary: `Removed ${card?.name ?? "a collection entry"}`,
      before,
      after: []
    });
    return null;
  }
});

export const history = query({
  args: {
    limit: v.optional(v.number())
  },
  returns: v.array(collectionMutationAuditEntryValidator),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const limit = Math.min(100, Math.max(1, Math.trunc(args.limit ?? 50)));
    const entries = await ctx.db
      .query("collectionMutationAudits")
      .withIndex("by_user", (q) => q.eq("userId", viewer._id))
      .order("desc")
      .take(limit);
    const undoRows = await Promise.all(
      entries.map((entry) =>
        ctx.db
          .query("collectionMutationAudits")
          .withIndex("by_source_audit", (q) => q.eq("sourceAuditId", entry._id))
          .unique()
      )
    );
    return entries.map((entry, index) => ({
      id: entry._id,
      operationKind: entry.operationKind,
      actorId: entry.actorId,
      affectedCopies: entry.affectedCopies,
      binderId: entry.binderId,
      cardName: entry.cardName,
      summary: entry.summary,
      sourceAuditId: entry.sourceAuditId,
      canUndo: entry.operationKind !== "undo" && undoRows[index] === null,
      createdAt: new Date(entry.createdAt).toISOString()
    }));
  }
});

export const undo = mutation({
  args: {
    auditId: v.id("collectionMutationAudits"),
    idempotencyKey: v.string()
  },
  returns: collectionMutationAuditEntryValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const audit = await undoAuditedCollectionMutation(ctx, {
      userId: viewer._id,
      actorId: viewer.authSubject,
      auditId: args.auditId,
      idempotencyKey: args.idempotencyKey
    });
    return {
      id: audit._id,
      operationKind: audit.operationKind,
      actorId: audit.actorId,
      affectedCopies: audit.affectedCopies,
      binderId: audit.binderId,
      cardName: audit.cardName,
      summary: audit.summary,
      sourceAuditId: audit.sourceAuditId,
      canUndo: false,
      createdAt: new Date(audit.createdAt).toISOString()
    };
  }
});
