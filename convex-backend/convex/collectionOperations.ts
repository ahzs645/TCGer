import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { addEntryForViewer } from "./lib/library";
import { appendCollectionAudit, snapshotAuditEntries } from "./lib/collectionAudit";
import { cardSnapshotValidator } from "./lib/validators";

async function viewer(ctx: MutationCtx, subject: string) {
  const user = await ctx.db.query("users").withIndex("by_auth_subject", q => q.eq("authSubject", subject)).unique();
  if (!user) throw new ConvexError({ code: "UNAUTHORIZED", message: "Viewer not provisioned" });
  return user;
}

const rapidItemValidator = v.object({
  rowId: v.string(),
  collectorNumber: v.string(),
  entryId: v.id("collectionEntries"),
  auditId: v.id("collectionMutationAudits"),
  quantity: v.number(),
});

export const rapidSetEntry = internalMutation({
  args: {
    subject: v.string(), binderId: v.id("binders"), tcg: v.string(), setCode: v.string(),
    entries: v.array(v.object({ rowId: v.string(), collectorNumber: v.string(), card: cardSnapshotValidator, quantity: v.optional(v.number()), condition: v.optional(v.string()), language: v.optional(v.string()) })),
  },
  returns: v.object({ receiptId: v.string(), addedRows: v.number(), addedCopies: v.number(), items: v.array(rapidItemValidator) }),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    if (!args.entries.length || args.entries.length > 100) throw new ConvexError({ code: "BAD_REQUEST", message: "Rapid entry requires 1–100 rows" });
    const receiptId = `rapid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const rowIds = new Set<string>();
    const items: Array<{ rowId: string; collectorNumber: string; entryId: Id<"collectionEntries">; auditId: Id<"collectionMutationAudits">; quantity: number }> = [];
    let addedCopies = 0;
    for (const input of args.entries) {
      if (!input.rowId.trim() || rowIds.has(input.rowId)) throw new ConvexError({ code: "BAD_REQUEST", message: "rowId must be non-empty and unique" });
      rowIds.add(input.rowId);
      const quantity = input.quantity ?? 1;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new ConvexError({ code: "BAD_REQUEST", message: "quantity must be between 1 and 100" });
      if (input.card.tcg !== args.tcg || input.card.setCode !== args.setCode || input.card.collectorNumber !== input.collectorNumber) throw new ConvexError({ code: "BAD_REQUEST", message: `Row ${input.rowId} does not match the pinned set and collector number` });
      const entry = await addEntryForViewer(ctx, user._id, { binderId: args.binderId, card: input.card, quantity, condition: input.condition, language: input.language });
      const after = await snapshotAuditEntries(ctx, user._id, [entry.id]);
      const auditId = await appendCollectionAudit(ctx, { userId: user._id, actorId: user.authSubject, operationKind: "rapid_entry", binderId: args.binderId, cardName: input.card.name, summary: `Rapid entry ${input.collectorNumber}: ${input.card.name}`, before: [], after, idempotencyKey: `${receiptId}:${input.rowId}` });
      items.push({ rowId: input.rowId, collectorNumber: input.collectorNumber, entryId: entry.id, auditId, quantity });
      addedCopies += quantity;
    }
    return { receiptId, addedRows: items.length, addedCopies, items };
  },
});

function allocateCents(totalCents: number, lines: Array<{ entryId: Id<"collectionEntries">; weight: number }>) {
  const totalWeight = lines.reduce((sum, line) => sum + line.weight, 0);
  const raw = lines.map(line => ({ ...line, exact: totalCents * line.weight / totalWeight }));
  const floors = raw.map(line => ({ ...line, cents: Math.floor(line.exact) }));
  let remainder = totalCents - floors.reduce((sum, line) => sum + line.cents, 0);
  for (const line of [...floors].sort((a, b) => (b.exact - b.cents) - (a.exact - a.cents) || a.entryId.localeCompare(b.entryId))) {
    if (remainder-- <= 0) break;
    line.cents += 1;
  }
  return floors;
}

export const splitAcquisitionCost = internalMutation({
  args: { subject: v.string(), totalCents: v.number(), currency: v.string(), mode: v.union(v.literal("equal"), v.literal("weighted")), lines: v.array(v.object({ collectionEntryId: v.id("collectionEntries"), weight: v.optional(v.number()) })), notes: v.optional(v.string()) },
  returns: v.object({ allocationGroupId: v.string(), totalCents: v.number(), currency: v.string(), auditId: v.id("collectionMutationAudits"), allocations: v.array(v.object({ collectionEntryId: v.id("collectionEntries"), allocatedCents: v.number(), acquisitionPrice: v.number(), transactionId: v.id("transactions") })) }),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    if (!Number.isSafeInteger(args.totalCents) || args.totalCents < 1) throw new ConvexError({ code: "BAD_REQUEST", message: "totalCents must be a positive safe integer" });
    if (!/^[A-Za-z]{3}$/.test(args.currency) || !args.lines.length || args.lines.length > 500) throw new ConvexError({ code: "BAD_REQUEST", message: "A valid currency and 1–500 lines are required" });
    if (args.totalCents < args.lines.length) throw new ConvexError({ code: "BAD_REQUEST", message: "totalCents must allocate at least one cent to every line" });
    const seen = new Set<string>();
    const owned: Doc<"collectionEntries">[] = [];
    for (const line of args.lines) {
      if (seen.has(line.collectionEntryId)) throw new ConvexError({ code: "BAD_REQUEST", message: "Each entry may appear only once" });
      seen.add(line.collectionEntryId);
      const entry = await ctx.db.get(line.collectionEntryId);
      if (!entry || entry.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Collection entry not found" });
      if (args.mode === "weighted" && (!Number.isFinite(line.weight) || (line.weight ?? 0) <= 0)) throw new ConvexError({ code: "BAD_REQUEST", message: "Every weighted line requires a positive weight" });
      owned.push(entry);
    }
    const before = await snapshotAuditEntries(ctx, user._id, owned.map(row => row._id));
    const weights = args.lines.map(line => ({ entryId: line.collectionEntryId, weight: args.mode === "equal" ? 1 : line.weight! }));
    const split = allocateCents(args.totalCents, weights);
    const now = Date.now();
    const currency = args.currency.toUpperCase();
    const allocationGroupId = `cost_${now}_${Math.random().toString(36).slice(2, 10)}`;
    const allocations = [];
    for (const allocation of split) {
      const entry = owned.find(row => row._id === allocation.entryId)!;
      const card = await ctx.db.get(entry.cardId);
      const acquisitionPrice = allocation.cents / 100 / entry.quantity;
      await ctx.db.patch(entry._id, { acquisitionPrice, updatedAt: now });
      const transactionId = await ctx.db.insert("transactions", { userId: user._id, type: "purchase", collectionEntryId: entry._id, cardId: entry.cardId, externalId: card?.externalId, tcg: card?.tcg, cardName: card?.name, quantity: entry.quantity, amount: allocation.cents / 100, amountCents: allocation.cents, allocationGroupId, currency, notes: args.notes, date: now, createdAt: now, updatedAt: now });
      allocations.push({ collectionEntryId: entry._id, allocatedCents: allocation.cents, acquisitionPrice, transactionId });
    }
    const summary = await ctx.db.query("financeSummaries").withIndex("by_user", q => q.eq("userId", user._id)).unique();
    if (summary) await ctx.db.patch(summary._id, { totalSpent: summary.totalSpent + args.totalCents / 100, transactionCount: summary.transactionCount + allocations.length, updatedAt: now });
    else await ctx.db.insert("financeSummaries", { userId: user._id, totalSpent: args.totalCents / 100, totalEarned: 0, transactionCount: allocations.length, updatedAt: now });
    const after = await snapshotAuditEntries(ctx, user._id, owned.map(row => row._id));
    const auditId = await appendCollectionAudit(ctx, { userId: user._id, actorId: user.authSubject, operationKind: "acquisition_split", summary: `Split ${currency} ${(args.totalCents / 100).toFixed(2)} across ${allocations.length} entries`, before, after, idempotencyKey: allocationGroupId });
    return { allocationGroupId, totalCents: args.totalCents, currency, auditId, allocations };
  },
});
