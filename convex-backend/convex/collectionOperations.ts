import type { RichCardSnapshot } from "./lib/cardMetadata";
import { inventoryIntakeSchema } from "@tcg/api-types";
import { acquisitionReceiptValidator, intakeReceiptValidator, operationReceipt } from "./lib/operationReceipts";
import { normalizePhysicalCopies, resolvePhysicalCopyId } from "./lib/inventoryAvailability";
import { requireBinderForUser } from "./lib/domain";
import { resolveCardSnapshot } from "./bridge";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { addEntryForViewer, removeEntryForViewer } from "./lib/library";
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
  entryIds: v.array(v.id("collectionEntries")),
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
    if (args.entries.reduce((sum, row) => sum + (row.quantity ?? 1), 0) > 500) throw new ConvexError({ code: "BAD_REQUEST", message: "Rapid entry supports at most 500 physical copies per operation" });
    const receiptId = `rapid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const rowIds = new Set<string>();
    const items: Array<{ rowId: string; collectorNumber: string; entryId: Id<"collectionEntries">; entryIds: Id<"collectionEntries">[]; auditId: Id<"collectionMutationAudits">; quantity: number }> = [];
    let addedCopies = 0;
    for (const input of args.entries) {
      if (!input.rowId.trim() || rowIds.has(input.rowId)) throw new ConvexError({ code: "BAD_REQUEST", message: "rowId must be non-empty and unique" });
      rowIds.add(input.rowId);
      const quantity = input.quantity ?? 1;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new ConvexError({ code: "BAD_REQUEST", message: "quantity must be between 1 and 100" });
      if (input.card.tcg !== args.tcg || input.card.setCode !== args.setCode || input.card.collectorNumber !== input.collectorNumber) throw new ConvexError({ code: "BAD_REQUEST", message: `Row ${input.rowId} does not match the pinned set and collector number` });
      const entryIds: Id<"collectionEntries">[] = [];
      for (let index = 0; index < quantity; index += 1) {
        const entry = await addEntryForViewer(ctx, user._id, { binderId: args.binderId, card: input.card, quantity: 1, condition: input.condition, language: input.language });
        entryIds.push(entry.id);
      }
      const after = await snapshotAuditEntries(ctx, user._id, entryIds);
      const auditId = await appendCollectionAudit(ctx, { userId: user._id, actorId: user.authSubject, operationKind: "rapid_entry", binderId: args.binderId, cardName: input.card.name, summary: `Rapid entry ${input.collectorNumber}: ${input.card.name}`, before: [], after, idempotencyKey: `${receiptId}:${input.rowId}` });
      items.push({ rowId: input.rowId, collectorNumber: input.collectorNumber, entryId: entryIds[0]!, entryIds, auditId, quantity });
      addedCopies += quantity;
    }
    return { receiptId, addedRows: items.length, addedCopies, items };
  },
});

function allocateCents(totalCents: number, lines: Array<{ entryId: Id<"collectionEntries">; weight: number }>) {
  const totalWeight = lines.reduce((sum, line) => sum + line.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) throw new ConvexError({ code: "BAD_REQUEST", message: "Allocation weights exceed the supported range" });
  const raw = lines.map(line => ({ ...line, exact: totalCents * (line.weight / totalWeight) }));
  const floors = raw.map(line => ({ ...line, cents: Math.floor(line.exact) }));
  let remainder = totalCents - floors.reduce((sum, line) => sum + line.cents, 0);
  for (const line of [...floors].sort((a, b) => (b.exact - b.cents) - (a.exact - a.cents) || a.entryId.localeCompare(b.entryId))) {
    if (remainder-- <= 0) break;
    line.cents += 1;
  }
  return floors;
}

export const splitAcquisitionCost = internalMutation({
  args: { subject: v.string(), operationId: v.optional(v.string()), totalCents: v.number(), currency: v.string(), mode: v.union(v.literal("equal"), v.literal("weighted")), lines: v.array(v.object({ collectionEntryId: v.string(), weight: v.optional(v.number()) })), notes: v.optional(v.string()) },
  returns: acquisitionReceiptValidator,
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const { subject: _, ...payload } = args;
    const replay = args.operationId ? await operationReceipt(ctx, user._id, "acquisition", args.operationId, payload) : undefined;
    if (replay?.prior) return replay.prior;
    if (!Number.isSafeInteger(args.totalCents) || args.totalCents < 1) throw new ConvexError({ code: "BAD_REQUEST", message: "totalCents must be a positive safe integer" });
    if (!/^[A-Za-z]{3}$/.test(args.currency) || !args.lines.length || args.lines.length > 500) throw new ConvexError({ code: "BAD_REQUEST", message: "A valid currency and 1–500 lines are required" });
    if (args.totalCents < args.lines.length) throw new ConvexError({ code: "BAD_REQUEST", message: "totalCents must allocate at least one cent to every line" });
    const seen = new Set<string>();
    const owned: Doc<"collectionEntries">[] = [];
    for (const line of args.lines) {
      const entryId = await resolvePhysicalCopyId(ctx, user._id, line.collectionEntryId);
      if (seen.has(entryId)) throw new ConvexError({ code: "BAD_REQUEST", message: "Each entry may appear only once" });
      seen.add(entryId);
      const entry = await ctx.db.get(entryId);
      if (!entry || entry.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Collection entry not found" });
      const purchases = await ctx.db.query("transactions").withIndex("by_user_and_collection_entry", q => q.eq("userId", user._id).eq("collectionEntryId", entry._id)).take(101);
      if (purchases.length > 100) throw new ConvexError({ code: "CONFLICT", message: "A selected copy has too many linked transactions; reconcile its acquisition ledger first" });
      if (purchases.some(row => row.type === "purchase")) throw new ConvexError({ code: "CONFLICT", message: "A selected copy already has a purchase. Edit or remove its existing acquisition before allocating another purchase." });
      if (args.mode === "weighted" && (!Number.isFinite(line.weight) || (line.weight ?? 0) <= 0)) throw new ConvexError({ code: "BAD_REQUEST", message: "Every weighted line requires a positive weight" });
      owned.push(entry);
    }
    const before = await snapshotAuditEntries(ctx, user._id, owned.map(row => row._id));
    const weights = args.lines.map((line, index) => ({ entryId: owned[index]!._id, weight: args.mode === "equal" ? 1 : line.weight! }));
    const split = allocateCents(args.totalCents, weights);
    if (split.some(line => line.cents < 1)) throw new ConvexError({ code: "BAD_REQUEST", message: "The weights must allocate at least one cent to every copy" });
    const now = Date.now();
    const currency = args.currency.toUpperCase();
    const allocationGroupId = `cost_${now}_${Math.random().toString(36).slice(2, 10)}`;
    const allocations = [];
    for (const allocation of split) {
      const entry = owned.find(row => row._id === allocation.entryId)!;
      const card = await ctx.db.get(entry.cardId);
      const acquisitionPrice = allocation.cents / 100 / entry.quantity;
      await ctx.db.patch(entry._id, { acquisitionPrice, acquisitionCurrency: currency, updatedAt: now });
      const transactionId = await ctx.db.insert("transactions", { userId: user._id, type: "purchase", collectionEntryId: entry._id, cardId: entry.cardId, externalId: card?.externalId, tcg: card?.tcg, cardName: card?.name, quantity: entry.quantity, amount: allocation.cents / 100, amountCents: allocation.cents, allocationGroupId, currency, notes: args.notes, date: now, createdAt: now, updatedAt: now });
      await ctx.db.patch(entry._id, { acquisitionTransactionId: transactionId });
      allocations.push({ collectionEntryId: entry._id, allocatedCents: allocation.cents, acquisitionPrice, transactionId });
    }
    const summary = await ctx.db.query("financeSummaries").withIndex("by_user", q => q.eq("userId", user._id)).unique();
    if (summary) await ctx.db.patch(summary._id, { totalSpent: summary.totalSpent + args.totalCents / 100, transactionCount: summary.transactionCount + allocations.length, updatedAt: now });
    else await ctx.db.insert("financeSummaries", { userId: user._id, totalSpent: args.totalCents / 100, totalEarned: 0, transactionCount: allocations.length, updatedAt: now });
    const after = await snapshotAuditEntries(ctx, user._id, owned.map(row => row._id));
    const auditId = await appendCollectionAudit(ctx, { userId: user._id, actorId: user.authSubject, operationKind: "acquisition_split", summary: `Split ${currency} ${(args.totalCents / 100).toFixed(2)} across ${allocations.length} entries`, before, after, idempotencyKey: allocationGroupId, financialTransactionIds: allocations.map(row => row.transactionId) });
    const receipt = { allocationGroupId, totalCents: args.totalCents, currency, auditId, allocations };
    if (args.operationId && replay) await ctx.db.insert("inventoryOperationReceipts", { userId: user._id, operationId: args.operationId, kind: "acquisition", requestFingerprint: replay.fingerprint, receipt, createdAt: now });
    return receipt;
  },
});

// These operations commit their receipt in the same transaction as every write.
// A lost HTTP response can therefore be retried with exactly the same payload.
export const commitIntake = internalMutation({
  args: {
    subject: v.string(), binderId: v.id("binders"), operationId: v.string(),
    source: v.union(v.literal("scanner"), v.literal("physical-opening")),
    rows: v.array(v.any()), sealedInventoryId: v.optional(v.id("sealedInventory")),
    openedQuantity: v.optional(v.number()), openedAt: v.optional(v.string()), notes: v.optional(v.string()),
  },
  returns: intakeReceiptValidator,
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const parsed = inventoryIntakeSchema.safeParse(args);
    if (!parsed.success) throw new ConvexError({ code: "BAD_REQUEST", message: parsed.error.issues.map(issue => issue.message).join("; ") });
    const input = parsed.data;
    const replay = await operationReceipt(ctx, user._id, "intake", args.operationId, { ...input, binderId: args.binderId });
    if (replay.prior) return replay.prior;
    await requireBinderForUser(ctx, args.binderId, user._id);
    const inventory = args.sealedInventoryId ? await ctx.db.get(args.sealedInventoryId) : null;
    if (args.sealedInventoryId && (!inventory || inventory.userId !== user._id)) throw new ConvexError({ code: "NOT_FOUND", message: "Sealed inventory not found" });
    const openedQuantity = input.openedQuantity ?? 1;
    if (inventory && inventory.quantity < openedQuantity) throw new ConvexError({ code: "CONFLICT", message: "Opened quantity exceeds sealed inventory" });
    const rows: Array<{ rowId: string; entryIds: Id<"collectionEntries">[] }> = [];
    for (const row of input.rows) {
      const card = await resolveCardSnapshot(ctx, { cardId: row.cardId, cardData: row.cardData ? JSON.parse(JSON.stringify(row.cardData)) as RichCardSnapshot : undefined }, "Reviewed cardData is required for intake");
      const ids: Id<"collectionEntries">[] = [];
      for (let index = 0; index < (row.quantity ?? 1); index += 1) {
        const entry = await addEntryForViewer(ctx, user._id, {
          ...row, binderId: args.binderId, card, quantity: 1,
          tagIds: row.tags as Id<"tags">[] | undefined,
          newTags: row.newTags?.map(tag => ({ ...tag, colorHex: tag.colorHex ?? "64748b" })),
        });
        ids.push(entry.id);
      }
      rows.push({ rowId: row.rowId, entryIds: ids });
    }
    const entryIds = rows.flatMap(row => row.entryIds);
    const timestamp = Date.now();
    let openingId: Id<"sealedOpenings"> | undefined;
    if (inventory) {
      openingId = await ctx.db.insert("sealedOpenings", {
        userId: user._id, sealedInventoryId: inventory._id, openedQuantity,
        openedAt: input.openedAt ? Date.parse(input.openedAt) : timestamp,
        notes: input.notes, createdAt: timestamp, updatedAt: timestamp,
      });
      for (const id of entryIds) {
        const entry = (await ctx.db.get(id))!;
        const card = (await ctx.db.get(entry.cardId))!;
        await ctx.db.insert("sealedOpenedCards", { userId: user._id, openingId, collectionId: id,
          externalId: card.externalId, tcg: card.tcg, cardName: card.name, quantity: 1,
          status: "active", createdAt: timestamp, updatedAt: timestamp });
      }
      await ctx.db.patch(inventory._id, { quantity: inventory.quantity - openedQuantity, updatedAt: timestamp });
    }
    await appendCollectionAudit(ctx, { userId: user._id, actorId: user.authSubject,
      operationKind: input.source === "physical-opening" ? "physical_opening" : "bulk",
      binderId: args.binderId, summary: `Saved ${entryIds.length} reviewed ${input.source} copies`,
      before: [], after: await snapshotAuditEntries(ctx, user._id, entryIds) });
    const receipt = { operationId: input.operationId, entryIds, rows, ...(openingId ? { openingId } : {}) };
    await ctx.db.insert("inventoryOperationReceipts", { userId: user._id, operationId: input.operationId,
      kind: "intake", requestFingerprint: replay.fingerprint, receipt, createdAt: timestamp });
    return receipt;
  },
});

export const removeCopy = internalMutation({
  args: { subject: v.string(), binderId: v.id("binders"), entryId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const entryId = await resolvePhysicalCopyId(ctx, user._id, args.entryId);
    const entry = await ctx.db.get(entryId);
    if (!entry || entry.userId !== user._id || entry.binderId !== args.binderId) throw new ConvexError({ code: "NOT_FOUND", message: "Collection copy not found" });
    await normalizePhysicalCopies(ctx, entry);
    const before = await snapshotAuditEntries(ctx, user._id, [entry._id]);
    await removeEntryForViewer(ctx, user._id, entry._id);
    await appendCollectionAudit(ctx, { userId: user._id, actorId: user.authSubject, operationKind: "remove",
      binderId: args.binderId, summary: "Removed one physical copy", before, after: [] });
    return null;
  },
});

/** Bounded, restartable migration. Dry-run reports the next batch only. */
export const normalizeLegacyCopies = internalMutation({
  args: { subject: v.string(), dryRun: v.optional(v.boolean()), limit: v.optional(v.number()) },
  returns: v.object({ dryRun: v.boolean(), normalizedRows: v.number(), createdCopies: v.number(), remaining: v.boolean(), entryIds: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const dryRun = args.dryRun ?? true;
    const limit = args.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ConvexError({ code: "BAD_REQUEST", message: "limit must be between 1 and 100" });
    const invalid = await ctx.db.query("collectionEntries").withIndex("by_user_and_quantity", q => q.eq("userId", user._id).lt("quantity", 1)).first();
    if (invalid) throw new ConvexError({ code: "CONFLICT", message: "A legacy row has no positive physical quantity; reconcile it before normalization" });
    const candidates = await ctx.db.query("collectionEntries").withIndex("by_user_and_quantity", q => q.eq("userId", user._id).gt("quantity", 1)).take(limit + 1);
    let normalizedRows = 0; let createdCopies = 0; let physicalCopies = 0;
    const entryIds: string[] = [];
    for (const entry of candidates.slice(0, limit)) {
      if (!Number.isSafeInteger(entry.quantity) || entry.quantity > 500) throw new ConvexError({ code: "CONFLICT", message: "A legacy row exceeds the 500-copy normalization limit; reconcile that row before normalization" });
      if (physicalCopies + entry.quantity > 500) break;
      if (dryRun) entryIds.push(...Array.from({ length: entry.quantity }, (_, index) => index === 0 ? entry._id : `${entry._id}#${index + 1}`));
      else {
        const before = await snapshotAuditEntries(ctx, user._id, [entry._id]);
        const ids = await normalizePhysicalCopies(ctx, entry);
        entryIds.push(...ids);
        await appendCollectionAudit(ctx, { userId: user._id, actorId: user.authSubject, operationKind: "normalization", binderId: entry.binderId,
          summary: `Normalized ${entry.quantity} physical copies from a legacy quantity row`, before, after: await snapshotAuditEntries(ctx, user._id, ids) });
      }
      normalizedRows += 1;
      createdCopies += entry.quantity - 1;
      physicalCopies += entry.quantity;
    }
    return { dryRun, normalizedRows, createdCopies, remaining: candidates.length > normalizedRows || Boolean(dryRun && candidates.length), entryIds };
  },
});
