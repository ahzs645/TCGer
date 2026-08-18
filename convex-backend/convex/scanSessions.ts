import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { addEntryForViewer } from "./lib/library";

const tcgValidator = v.union(
  v.literal("yugioh"),
  v.literal("magic"),
  v.literal("pokemon"),
  v.literal("onepiece"),
  v.literal("lorcana"),
  v.literal("dragonball"),
);

const sessionValidator = v.object({
  id: v.id("scanSessions"),
  code: v.string(),
  name: v.string(),
  status: v.union(v.literal("open"), v.literal("committed"), v.literal("closed")),
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
    throw new ConvexError({ code: "UNAUTHORIZED", message: "Viewer not provisioned" });
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
    throw new ConvexError({ code: "NOT_FOUND", message: "Scan session not found" });
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
    const sessionId = await ctx.db.insert("scanSessions", {
      userId: viewer._id,
      code: "pending",
      name: args.name?.trim() || "Web scan session",
      status: "open",
      defaultLanguage: args.defaultLanguage?.trim() || "English",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const code = sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase();
    await ctx.db.patch(sessionId, { code });
    const session = await ctx.db.get(sessionId);
    if (!session) throw new ConvexError({ code: "INVARIANT", message: "Scan session was not created" });
    return await serializeSession(ctx, session);
  },
});

export const getSession = internalQuery({
  args: { subject: v.string(), sessionId: v.id("scanSessions") },
  returns: sessionValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    return await serializeSession(ctx, await requireSession(ctx, args.sessionId, viewer._id));
  },
});

export const findOpenSession = internalQuery({
  args: { subject: v.string(), code: v.optional(v.string()) },
  returns: v.union(sessionValidator, v.null()),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const session = args.code
      ? await ctx.db.query("scanSessions").withIndex("by_code", (q) => q.eq("code", args.code!.trim().toUpperCase())).unique()
      : await ctx.db.query("scanSessions").withIndex("by_user_and_status", (q) => q.eq("userId", viewer._id).eq("status", "open")).order("desc").first();
    if (!session || session.userId !== viewer._id || session.status !== "open") return null;
    return await serializeSession(ctx, session);
  },
});

export const listItems = internalQuery({
  args: { subject: v.string(), sessionId: v.id("scanSessions") },
  returns: v.array(itemValidator),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    await requireSession(ctx, args.sessionId, viewer._id);
    const items = await ctx.db.query("scanSessionItems").withIndex("by_session", (q) => q.eq("sessionId", args.sessionId)).order("asc").take(500);
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
    const session = await ctx.db.query("scanSessions").withIndex("by_code", (q) => q.eq("code", args.code.trim().toUpperCase())).unique();
    if (!session || session.userId !== viewer._id || session.status !== "open") {
      throw new ConvexError({ code: "NOT_FOUND", message: "Open scan session not found" });
    }
    const existing = await ctx.db.query("scanSessionItems").withIndex("by_session_and_event", (q) => q.eq("sessionId", session._id).eq("clientEventId", args.clientEventId)).unique();
    if (existing) return serializeItem(existing);
    const timestamp = Date.now();
    const itemId = await ctx.db.insert("scanSessionItems", {
      userId: viewer._id,
      sessionId: session._id,
      clientEventId: args.clientEventId,
      tcg: args.tcg,
      externalId: args.externalId,
      name: args.name,
      setCode: args.setCode,
      setName: args.setName,
      rarity: args.rarity,
      imageUrl: args.imageUrl,
      price: args.price,
      confidence: args.confidence,
      condition: args.condition,
      language: args.language?.trim() || session.defaultLanguage,
      finishCode: args.finishCode,
      finishLabel: args.finishLabel,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.db.patch(session._id, { updatedAt: timestamp });
    const item = await ctx.db.get(itemId);
    if (!item) throw new ConvexError({ code: "INVARIANT", message: "Scan item was not created" });
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
      throw new ConvexError({ code: "NOT_FOUND", message: "Editable scan item not found" });
    }
    const patch: Partial<Doc<"scanSessionItems">> = { updatedAt: Date.now() };
    if (args.language !== undefined) patch.language = args.language.trim();
    if (args.condition !== undefined) patch.condition = args.condition.trim();
    if (args.finishCode !== undefined) patch.finishCode = args.finishCode ?? undefined;
    if (args.finishLabel !== undefined) patch.finishLabel = args.finishLabel ?? undefined;
    await ctx.db.patch(item._id, patch);
    const updated = await ctx.db.get(item._id);
    if (!updated) throw new ConvexError({ code: "INVARIANT", message: "Scan item disappeared" });
    return serializeItem(updated);
  },
});

export const commitSession = internalMutation({
  args: { subject: v.string(), sessionId: v.id("scanSessions"), binderId: v.id("binders") },
  returns: v.object({ committed: v.number() }),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const session = await requireSession(ctx, args.sessionId, viewer._id);
    if (session.status !== "open") throw new ConvexError({ code: "BAD_REQUEST", message: "Scan session is not open" });
    const items = await ctx.db.query("scanSessionItems").withIndex("by_session", (q) => q.eq("sessionId", session._id)).take(500);
    let committed = 0;
    for (const item of items) {
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
        isFoil: item.finishCode ? !["normal", "nonholo"].includes(item.finishCode.toLowerCase()) : undefined,
        finishCode: item.finishCode,
        finishLabel: item.finishLabel,
      });
      await ctx.db.patch(item._id, { committedEntryId: entry.id, updatedAt: Date.now() });
      committed += 1;
    }
    await ctx.db.patch(session._id, { status: "committed", binderId: args.binderId, updatedAt: Date.now() });
    return { committed };
  },
});
