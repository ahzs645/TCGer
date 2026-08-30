import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";

type ReaderCtx = QueryCtx | MutationCtx;
const allocationValidator = v.object({
  id: v.id("deckCheckoutAllocations"), deckCardId: v.id("deckCards"),
  collectionEntryId: v.id("collectionEntries"), quantity: v.number(),
  containerId: v.optional(v.id("storageContainers")), compartmentId: v.optional(v.id("storageCompartments")),
  slotIndex: v.optional(v.number()), refilledAt: v.optional(v.string()),
});
const sessionValidator = v.object({
  id: v.id("deckCheckoutSessions"), deckId: v.id("decks"),
  status: v.union(v.literal("checked_out"), v.literal("checked_in")), note: v.optional(v.string()),
  checkedOutAt: v.string(), checkedInAt: v.optional(v.string()), allocations: v.array(allocationValidator),
});

async function viewer(ctx: ReaderCtx, subject: string) {
  const user = await ctx.db.query("users").withIndex("by_auth_subject", q => q.eq("authSubject", subject)).unique();
  if (!user) throw new ConvexError({ code: "UNAUTHORIZED", message: "Viewer not provisioned" });
  return user;
}
async function deckFor(ctx: ReaderCtx, deckId: Id<"decks">, userId: Id<"users">) {
  const deck = await ctx.db.get(deckId);
  if (!deck || deck.userId !== userId) throw new ConvexError({ code: "NOT_FOUND", message: "Deck not found" });
  return deck;
}
async function hydrate(ctx: ReaderCtx, session: Doc<"deckCheckoutSessions">) {
  const allocations = await ctx.db.query("deckCheckoutAllocations").withIndex("by_session", q => q.eq("sessionId", session._id)).take(1000);
  return { id: session._id, deckId: session.deckId, status: session.status, note: session.note,
    checkedOutAt: new Date(session.checkedOutAt).toISOString(),
    checkedInAt: session.checkedInAt === undefined ? undefined : new Date(session.checkedInAt).toISOString(),
    allocations: allocations.map(row => ({ id: row._id, deckCardId: row.deckCardId, collectionEntryId: row.collectionEntryId, quantity: row.quantity, containerId: row.containerId, compartmentId: row.compartmentId, slotIndex: row.slotIndex, refilledAt: row.refilledAt === undefined ? undefined : new Date(row.refilledAt).toISOString() })),
  };
}

export const active = internalQuery({
  args: { subject: v.string(), deckId: v.id("decks") }, returns: v.union(sessionValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject); await deckFor(ctx, args.deckId, user._id);
    const session = await ctx.db.query("deckCheckoutSessions").withIndex("by_deck_and_status", q => q.eq("deckId", args.deckId).eq("status", "checked_out")).unique();
    return session ? await hydrate(ctx, session) : null;
  },
});

export const checkout = internalMutation({
  args: { subject: v.string(), deckId: v.id("decks"), note: v.optional(v.string()) }, returns: sessionValidator,
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject); await deckFor(ctx, args.deckId, user._id);
    const activeSession = await ctx.db.query("deckCheckoutSessions").withIndex("by_deck_and_status", q => q.eq("deckId", args.deckId).eq("status", "checked_out")).unique();
    if (activeSession) throw new ConvexError({ code: "CONFLICT", message: "Deck is already checked out" });
    const deckCards = await ctx.db.query("deckCards").withIndex("by_deck", q => q.eq("deckId", args.deckId)).take(1000);
    const entries = await ctx.db.query("collectionEntries").withIndex("by_user", q => q.eq("userId", user._id)).take(16000);
    const cards = await Promise.all(entries.map(entry => ctx.db.get(entry.cardId)));
    const candidates = entries.map((entry, index) => ({ entry, card: cards[index] })).filter((value): value is { entry: Doc<"collectionEntries">; card: Doc<"cards"> } => value.card !== null);
    const reserved = new Map<Id<"collectionEntries">, number>();
    for (const candidate of candidates) {
      const rows = await ctx.db.query("deckCheckoutAllocations").withIndex("by_user_and_entry", q => q.eq("userId", user._id).eq("collectionEntryId", candidate.entry._id)).take(1000);
      for (const row of rows) {
        const session = await ctx.db.get(row.sessionId);
        if (session?.status === "checked_out") reserved.set(candidate.entry._id, (reserved.get(candidate.entry._id) ?? 0) + row.quantity);
      }
    }
    const planned: Array<{ deckCard: Doc<"deckCards">; entry: Doc<"collectionEntries">; quantity: number }> = [];
    for (const deckCard of deckCards) {
      let needed = deckCard.quantity;
      for (const candidate of candidates) {
        if (needed < 1) break;
        const ids = [candidate.card.externalId, candidate.card.baseExternalId].filter(Boolean);
        if (!ids.includes(deckCard.externalId)) continue;
        const free = candidate.entry.quantity - (reserved.get(candidate.entry._id) ?? 0) - planned.filter(row => row.entry._id === candidate.entry._id).reduce((sum, row) => sum + row.quantity, 0);
        const quantity = Math.min(needed, Math.max(0, free));
        if (quantity) { planned.push({ deckCard, entry: candidate.entry, quantity }); needed -= quantity; }
      }
      if (needed) throw new ConvexError({ code: "CONFLICT", message: `Not enough available copies of ${deckCard.name}; missing ${needed}` });
    }
    const now = Date.now();
    const sessionId = await ctx.db.insert("deckCheckoutSessions", { userId: user._id, deckId: args.deckId, status: "checked_out", note: args.note, checkedOutAt: now, createdAt: now, updatedAt: now });
    for (const row of planned) {
      const placements = await ctx.db.query("storagePlacements").withIndex("by_user_and_entry", q => q.eq("userId", user._id).eq("collectionEntryId", row.entry._id)).take(100);
      const placement = placements[0];
      await ctx.db.insert("deckCheckoutAllocations", { userId: user._id, sessionId, deckCardId: row.deckCard._id, collectionEntryId: row.entry._id, quantity: row.quantity, containerId: placement?.containerId, compartmentId: placement?.compartmentId, slotIndex: placement?.slotIndex, createdAt: now });
    }
    return await hydrate(ctx, (await ctx.db.get(sessionId))!);
  },
});

export const checkin = internalMutation({
  args: { subject: v.string(), deckId: v.id("decks") }, returns: sessionValidator,
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject); await deckFor(ctx, args.deckId, user._id);
    const session = await ctx.db.query("deckCheckoutSessions").withIndex("by_deck_and_status", q => q.eq("deckId", args.deckId).eq("status", "checked_out")).unique();
    if (!session || session.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Active checkout not found" });
    const now = Date.now();
    const allocations = await ctx.db.query("deckCheckoutAllocations").withIndex("by_session", q => q.eq("sessionId", session._id)).take(1000);
    for (const row of allocations) await ctx.db.patch(row._id, { refilledAt: now });
    await ctx.db.patch(session._id, { status: "checked_in", checkedInAt: now, updatedAt: now });
    return await hydrate(ctx, (await ctx.db.get(session._id))!);
  },
});
