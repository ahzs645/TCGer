import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { addEntryForViewer } from "./lib/library";
import { requireBinderForUser } from "./lib/domain";

const tcgValidator = v.union(
  v.literal("yugioh"),
  v.literal("magic"),
  v.literal("pokemon"),
  v.literal("onepiece"),
  v.literal("lorcana"),
  v.literal("dragonball"),
);

const MAX_SESSION_ITEMS = 500;

function requireText(value: string, field: string, maxLength: number) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${field} must be between 1 and ${maxLength} characters`,
    });
  }
  return trimmed;
}

function optionalText(
  value: string | undefined,
  field: string,
  maxLength: number,
) {
  return value === undefined ? undefined : requireText(value, field, maxLength);
}

const sessionValidator = v.object({
  id: v.id("scanSessions"),
  code: v.string(),
  name: v.string(),
  status: v.union(
    v.literal("open"),
    v.literal("committed"),
    v.literal("closed"),
  ),
  defaultLanguage: v.string(),
  binderId: v.optional(v.id("binders")),
  itemCount: v.number(),
  createdAt: v.string(),
  updatedAt: v.string(),
});

const itemValidator = v.object({
  id: v.id("scanSessionItems"),
  clientEventId: v.string(),
  tcg: tcgValidator,
  externalId: v.string(),
  name: v.string(),
  setCode: v.optional(v.string()),
  setName: v.optional(v.string()),
  rarity: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  price: v.optional(v.number()),
  confidence: v.optional(v.number()),
  condition: v.optional(v.string()),
  language: v.string(),
  finishCode: v.optional(v.string()),
  finishLabel: v.optional(v.string()),
  committedEntryId: v.optional(v.id("collectionEntries")),
  createdAt: v.string(),
  updatedAt: v.string(),
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

async function requireSession(
  ctx: ReaderCtx,
  sessionId: Id<"scanSessions">,
  userId: Id<"users">,
) {
  const session = await ctx.db.get(sessionId);
  if (!session || session.userId !== userId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Scan session not found",
    });
  }
  return session;
}

async function serializeSession(ctx: ReaderCtx, session: Doc<"scanSessions">) {
  const items = await ctx.db
    .query("scanSessionItems")
    .withIndex("by_session", (q) => q.eq("sessionId", session._id))
    .take(501);
  return {
    id: session._id,
    code: session.code,
    name: session.name,
    status: session.status,
    defaultLanguage: session.defaultLanguage,
    binderId: session.binderId,
    itemCount: Math.min(items.length, 500),
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
  };
}

function serializeItem(item: Doc<"scanSessionItems">) {
  return {
    id: item._id,
    clientEventId: item.clientEventId,
    tcg: item.tcg,
    externalId: item.externalId,
    name: item.name,
    setCode: item.setCode,
    setName: item.setName,
    rarity: item.rarity,
    imageUrl: item.imageUrl,
    price: item.price,
    confidence: item.confidence,
    condition: item.condition,
    language: item.language,
    finishCode: item.finishCode,
    finishLabel: item.finishLabel,
    committedEntryId: item.committedEntryId,
    createdAt: new Date(item.createdAt).toISOString(),
    updatedAt: new Date(item.updatedAt).toISOString(),
  };
}

export const createSession = internalMutation({
  args: {
    subject: v.string(),
    name: v.optional(v.string()),
    defaultLanguage: v.optional(v.string()),
  },
  returns: sessionValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const timestamp = Date.now();
    const name = args.name
      ? requireText(args.name, "name", 120)
      : "Web scan session";
    const defaultLanguage = args.defaultLanguage
      ? requireText(args.defaultLanguage, "defaultLanguage", 40)
      : "English";
    const sessionId = await ctx.db.insert("scanSessions", {
      userId: viewer._id,
      code: "pending",
      name,
      status: "open",
      defaultLanguage,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const code = sessionId
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(-8)
      .toUpperCase();
    await ctx.db.patch(sessionId, { code });
    const session = await ctx.db.get(sessionId);
    if (!session)
      throw new ConvexError({
        code: "INVARIANT",
        message: "Scan session was not created",
      });
    return await serializeSession(ctx, session);
  },
});

export const getSession = internalQuery({
  args: { subject: v.string(), sessionId: v.id("scanSessions") },
  returns: sessionValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    return await serializeSession(
      ctx,
      await requireSession(ctx, args.sessionId, viewer._id),
    );
  },
});

export const findOpenSession = internalQuery({
  args: { subject: v.string(), code: v.optional(v.string()) },
  returns: v.union(sessionValidator, v.null()),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const session = args.code
      ? await ctx.db
          .query("scanSessions")
          .withIndex("by_code", (q) =>
            q.eq("code", args.code!.trim().toUpperCase()),
          )
          .unique()
      : await ctx.db
          .query("scanSessions")
          .withIndex("by_user_and_status", (q) =>
            q.eq("userId", viewer._id).eq("status", "open"),
          )
          .order("desc")
          .first();
    if (!session || session.userId !== viewer._id || session.status !== "open")
      return null;
    return await serializeSession(ctx, session);
  },
});

export const listItems = internalQuery({
  args: { subject: v.string(), sessionId: v.id("scanSessions") },
  returns: v.array(itemValidator),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    await requireSession(ctx, args.sessionId, viewer._id);
    const items = await ctx.db
      .query("scanSessionItems")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .take(500);
    return items.map(serializeItem);
  },
});

export const addItem = internalMutation({
  args: {
    subject: v.string(),
    code: v.string(),
    clientEventId: v.string(),
    tcg: tcgValidator,
    externalId: v.string(),
    name: v.string(),
    setCode: v.optional(v.string()),
    setName: v.optional(v.string()),
    rarity: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    price: v.optional(v.number()),
    confidence: v.optional(v.number()),
    condition: v.optional(v.string()),
    language: v.optional(v.string()),
    finishCode: v.optional(v.string()),
    finishLabel: v.optional(v.string()),
  },
  returns: itemValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const code = requireText(args.code, "code", 32).toUpperCase();
    const session = await ctx.db
      .query("scanSessions")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (
      !session ||
      session.userId !== viewer._id ||
      session.status !== "open"
    ) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Open scan session not found",
      });
    }
    const clientEventId = requireText(args.clientEventId, "clientEventId", 128);
    const existing = await ctx.db
      .query("scanSessionItems")
      .withIndex("by_session_and_event", (q) =>
        q.eq("sessionId", session._id).eq("clientEventId", clientEventId),
      )
      .unique();
    if (existing) return serializeItem(existing);
    const itemLimitProbe = await ctx.db
      .query("scanSessionItems")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .take(MAX_SESSION_ITEMS);
    if (itemLimitProbe.length >= MAX_SESSION_ITEMS) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `A scan session can contain at most ${MAX_SESSION_ITEMS} items`,
      });
    }
    const externalId = requireText(args.externalId, "externalId", 256);
    const name = requireText(args.name, "name", 300);
    const language = args.language
      ? requireText(args.language, "language", 40)
      : session.defaultLanguage;
    if (
      args.price !== undefined &&
      (!Number.isFinite(args.price) || args.price < 0)
    ) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "price must be a finite non-negative number",
      });
    }
    if (
      args.confidence !== undefined &&
      (!Number.isFinite(args.confidence) ||
        args.confidence < 0 ||
        args.confidence > 1)
    ) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "confidence must be between 0 and 1",
      });
    }
    const timestamp = Date.now();
    const itemId = await ctx.db.insert("scanSessionItems", {
      userId: viewer._id,
      sessionId: session._id,
      clientEventId,
      tcg: args.tcg,
      externalId,
      name,
      setCode: optionalText(args.setCode, "setCode", 120),
      setName: optionalText(args.setName, "setName", 300),
      rarity: optionalText(args.rarity, "rarity", 120),
      imageUrl: optionalText(args.imageUrl, "imageUrl", 2_048),
      price: args.price,
      confidence: args.confidence,
      condition: optionalText(args.condition, "condition", 120),
      language,
      finishCode: optionalText(args.finishCode, "finishCode", 120),
      finishLabel: optionalText(args.finishLabel, "finishLabel", 120),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.db.patch(session._id, { updatedAt: timestamp });
    const item = await ctx.db.get(itemId);
    if (!item)
      throw new ConvexError({
        code: "INVARIANT",
        message: "Scan item was not created",
      });
    return serializeItem(item);
  },
});

export const updateItem = internalMutation({
  args: {
    subject: v.string(),
    itemId: v.id("scanSessionItems"),
    language: v.optional(v.string()),
    condition: v.optional(v.string()),
    finishCode: v.optional(v.union(v.string(), v.null())),
    finishLabel: v.optional(v.union(v.string(), v.null())),
  },
  returns: itemValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.userId !== viewer._id || item.committedEntryId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Editable scan item not found",
      });
    }
    const session = await requireSession(ctx, item.sessionId, viewer._id);
    if (session.status !== "open") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Scan session is not open",
      });
    }
    const patch: Partial<Doc<"scanSessionItems">> = { updatedAt: Date.now() };
    if (args.language !== undefined)
      patch.language = requireText(args.language, "language", 40);
    if (args.condition !== undefined)
      patch.condition = requireText(args.condition, "condition", 120);
    if (args.finishCode !== undefined)
      patch.finishCode =
        args.finishCode === null
          ? undefined
          : requireText(args.finishCode, "finishCode", 120);
    if (args.finishLabel !== undefined)
      patch.finishLabel =
        args.finishLabel === null
          ? undefined
          : requireText(args.finishLabel, "finishLabel", 120);
    await ctx.db.patch(item._id, patch);
    const updated = await ctx.db.get(item._id);
    if (!updated)
      throw new ConvexError({
        code: "INVARIANT",
        message: "Scan item disappeared",
      });
    return serializeItem(updated);
  },
});

export const removeItem = internalMutation({
  args: {
    subject: v.string(),
    itemId: v.id("scanSessionItems"),
  },
  returns: v.object({ removed: v.boolean() }),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.userId !== viewer._id || item.committedEntryId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Removable scan item not found",
      });
    }
    const session = await requireSession(ctx, item.sessionId, viewer._id);
    if (session.status !== "open") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Scan session is not open",
      });
    }
    await ctx.db.delete(item._id);
    await ctx.db.patch(session._id, { updatedAt: Date.now() });
    return { removed: true };
  },
});

export const clearItems = internalMutation({
  args: {
    subject: v.string(),
    sessionId: v.id("scanSessions"),
  },
  returns: v.object({ removed: v.number() }),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const session = await requireSession(ctx, args.sessionId, viewer._id);
    if (session.status !== "open") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Scan session is not open",
      });
    }
    const items = await ctx.db
      .query("scanSessionItems")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .take(500);
    const removable = items.filter((item) => !item.committedEntryId);
    for (const item of removable) await ctx.db.delete(item._id);
    if (removable.length > 0) {
      await ctx.db.patch(session._id, { updatedAt: Date.now() });
    }
    return { removed: removable.length };
  },
});

export const commitSession = internalMutation({
  args: {
    subject: v.string(),
    sessionId: v.id("scanSessions"),
    binderId: v.id("binders"),
    itemIds: v.optional(v.array(v.id("scanSessionItems"))),
  },
  returns: v.object({ committed: v.number() }),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const session = await requireSession(ctx, args.sessionId, viewer._id);
    if (session.status !== "open")
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Scan session is not open",
      });
    await requireBinderForUser(ctx, args.binderId, viewer._id);
    if (args.itemIds && args.itemIds.length > MAX_SESSION_ITEMS) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `At most ${MAX_SESSION_ITEMS} scan items can be committed at once`,
      });
    }
    const items = await ctx.db
      .query("scanSessionItems")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .take(MAX_SESSION_ITEMS + 1);
    if (items.length > MAX_SESSION_ITEMS) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `Scan session exceeds the ${MAX_SESSION_ITEMS}-item limit`,
      });
    }
    const requestedIds = args.itemIds ? new Set(args.itemIds) : null;
    if (requestedIds?.size === 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Select at least one scan item",
      });
    }
    if (requestedIds) {
      const sessionIds = new Set(items.map((item) => item._id));
      for (const itemId of requestedIds) {
        if (!sessionIds.has(itemId)) {
          throw new ConvexError({
            code: "BAD_REQUEST",
            message: "Selected scan item is not in this session",
          });
        }
      }
    }
    let committed = 0;
    for (const item of items) {
      if (requestedIds && !requestedIds.has(item._id)) continue;
      if (item.committedEntryId) continue;
      const entry = await addEntryForViewer(ctx, viewer._id, {
        binderId: args.binderId,
        card: {
          externalId: item.externalId,
          tcg: item.tcg,
          name: item.name,
          setCode: item.setCode,
          setName: item.setName,
          rarity: item.rarity,
          imageUrl: item.imageUrl,
          imageUrlSmall: item.imageUrl,
        },
        quantity: 1,
        condition: item.condition,
        language: item.language,
        price: item.price,
        isFoil: item.finishCode
          ? !["normal", "nonholo"].includes(item.finishCode.toLowerCase())
          : undefined,
        finishCode: item.finishCode,
        finishLabel: item.finishLabel,
      });
      await ctx.db.patch(item._id, {
        committedEntryId: entry.id,
        updatedAt: Date.now(),
      });
      committed += 1;
    }
    const hasUncommittedItems = items.some(
      (item) =>
        !item.committedEntryId &&
        (requestedIds ? !requestedIds.has(item._id) : false),
    );
    await ctx.db.patch(session._id, {
      status: hasUncommittedItems ? "open" : "committed",
      binderId: args.binderId,
      updatedAt: Date.now(),
    });
    return { committed };
  },
});
