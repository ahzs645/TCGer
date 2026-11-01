import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type ReaderCtx = MutationCtx | QueryCtx;

export function normalizeAcquisitionCurrency(value?: string | null) {
  if (value == null) return undefined;
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ConvexError({ code: "BAD_REQUEST", message: "acquisitionCurrency must be a three-letter currency code" });
  return currency;
}

/** Linked purchases own their cost metadata. General copy PATCH must not make
 * that metadata disagree with the financial ledger. */
export async function assertAcquisitionMetadataEditable(ctx: ReaderCtx, entry: Doc<"collectionEntries">, changes: {
  acquisitionPrice?: number | null; acquisitionCurrency?: string | null; acquiredAt?: string | null;
}) {
  const currency = normalizeAcquisitionCurrency(changes.acquisitionCurrency);
  if (changes.acquisitionPrice != null && (!Number.isFinite(changes.acquisitionPrice) || changes.acquisitionPrice < 0)) throw new ConvexError({ code: "BAD_REQUEST", message: "acquisitionPrice must be a non-negative amount" });
  if (changes.acquiredAt != null && !Number.isFinite(Date.parse(changes.acquiredAt))) throw new ConvexError({ code: "BAD_REQUEST", message: "acquiredAt must be a valid date" });
  const changed = (changes.acquisitionPrice !== undefined && (changes.acquisitionPrice ?? null) !== (entry.acquisitionPrice ?? null))
    || (changes.acquisitionCurrency !== undefined && (currency ?? null) !== (entry.acquisitionCurrency?.trim().toUpperCase() ?? null))
    || (changes.acquiredAt !== undefined && (changes.acquiredAt == null ? entry.acquiredAt != null : entry.acquiredAt == null || Date.parse(changes.acquiredAt) !== Date.parse(entry.acquiredAt)));
  if (!changed) return;
  const linked = await ctx.db.query("transactions").withIndex("by_user_and_collection_entry", q => q.eq("userId", entry.userId).eq("collectionEntryId", entry._id)).take(101);
  if (linked.length > 100) throw new ConvexError({ code: "CONFLICT", message: "This copy has too many linked transactions for a direct cost edit; use its acquisition ledger" });
  const acquisition = entry.acquisitionTransactionId ? await ctx.db.get(entry.acquisitionTransactionId) : null;
  if (linked.some(row => row.type === "purchase") || (acquisition?.type === "purchase" && acquisition.userId === entry.userId)) throw new ConvexError({ code: "CONFLICT", message: "This copy has a linked purchase. Edit or remove that acquisition through the finance API so its ledger and copy metadata stay consistent." });
}

/** All inventory consumers use the same active commitments, in one transaction. */
export async function committedQuantity(
  ctx: ReaderCtx,
  entry: Doc<"collectionEntries">,
  options: { excludeTradeId?: Id<"trades"> } = {},
) {
  const [reservations, allocations] = await Promise.all([
    ctx.db.query("tradeReservations").withIndex("by_entry_and_status", q =>
      q.eq("collectionEntryId", entry._id).eq("status", "reserved")).take(501),
    ctx.db.query("deckCheckoutAllocations").withIndex("by_user_and_entry", q =>
      q.eq("userId", entry.userId).eq("collectionEntryId", entry._id)).take(1001),
  ]);
  if (reservations.length > 500 || allocations.length > 1000) {
    throw new ConvexError({ code: "LIMIT_EXCEEDED", message: "Too many commitments for this copy" });
  }
  let quantity = reservations.filter(row => row.tradeId !== options.excludeTradeId)
    .reduce((sum, row) => sum + row.quantity, 0);
  for (const allocation of allocations) {
    const session = await ctx.db.get(allocation.sessionId);
    if (session?.status === "checked_out") quantity += allocation.quantity;
  }
  return quantity;
}

export async function assertInventoryAvailable(
  ctx: ReaderCtx,
  entry: Doc<"collectionEntries">,
  quantity = entry.quantity,
  options: { excludeTradeId?: Id<"trades"> } = {},
) {
  if (entry.quantity - await committedQuantity(ctx, entry, options) < quantity) {
    throw new ConvexError({ code: "CONFLICT", message: "This copy is checked out in a deck or reserved for a trade. Release it before changing its inventory assignment." });
  }
}

/** Convert a legacy quantity row without dropping metadata, tags or associations.
 * The original ID remains the first copy. Historical finance records keep their
 * original aggregate amount/quantity; active allocations are repartitioned.
 */
export async function normalizePhysicalCopies(ctx: MutationCtx, entry: Doc<"collectionEntries">) {
  if (entry.quantity === 1) return [entry._id];
  if (!Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 500) {
    throw new ConvexError({ code: "CONFLICT", message: "Legacy quantity must be between 1 and 500 before physical-copy normalization" });
  }
  const [tags, placements, reservations, allocations, openedCards] = await Promise.all([
    ctx.db.query("collectionEntryTags").withIndex("by_entry", q => q.eq("entryId", entry._id)).take(101),
    ctx.db.query("storagePlacements").withIndex("by_entry", q => q.eq("collectionEntryId", entry._id)).take(501),
    ctx.db.query("tradeReservations").withIndex("by_entry_and_status", q => q.eq("collectionEntryId", entry._id).eq("status", "reserved")).take(501),
    ctx.db.query("deckCheckoutAllocations").withIndex("by_entry", q => q.eq("collectionEntryId", entry._id)).take(1001),
    ctx.db.query("sealedOpenedCards").withIndex("by_collection", q => q.eq("collectionId", entry._id)).take(2),
  ]);
  if (tags.length > 100 || placements.length > 500 || reservations.length > 500 || allocations.length > 1000 || openedCards.length > 1) {
    throw new ConvexError({ code: "CONFLICT", message: "Legacy copy associations require reconciliation before normalization" });
  }
  const activeAllocations = [];
  for (const allocation of allocations) {
    if ((await ctx.db.get(allocation.sessionId))?.status === "checked_out") activeAllocations.push(allocation);
  }
  const committed = [...activeAllocations, ...reservations].reduce((sum, row) => sum + row.quantity, 0);
  if (committed > entry.quantity || placements.reduce((sum, row) => sum + row.quantity, 0) > entry.quantity || openedCards.some(row => row.quantity !== entry.quantity)) {
    throw new ConvexError({ code: "CONFLICT", message: "Legacy commitments overlap; reconcile them before normalizing physical copies" });
  }
  const { _id, _creationTime, ...value } = entry;
  const ids = [_id];
  await ctx.db.patch(_id, { quantity: 1 });
  for (let index = 1; index < entry.quantity; index += 1) {
    const copyId = await ctx.db.insert("collectionEntries", { ...value, quantity: 1, legacyQuantitySourceId: _id, legacyQuantityOrdinal: index + 1 });
    ids.push(copyId);
    for (const tag of tags) await ctx.db.insert("collectionEntryTags", { entryId: copyId, tagId: tag.tagId, assignedAt: tag.assignedAt });
  }
  let commitmentOffset = 0;
  for (const allocation of activeAllocations) {
    const { _id: allocationId, _creationTime: _, ...data } = allocation;
    await ctx.db.patch(allocationId, { collectionEntryId: ids[commitmentOffset++]!, quantity: 1 });
    for (let index = 1; index < allocation.quantity; index += 1) await ctx.db.insert("deckCheckoutAllocations", { ...data, collectionEntryId: ids[commitmentOffset++]!, quantity: 1 });
  }
  for (const reservation of reservations) {
    const { _id: reservationId, _creationTime: _, ...data } = reservation;
    await ctx.db.patch(reservationId, { collectionEntryId: ids[commitmentOffset++]!, quantity: 1 });
    for (let index = 1; index < reservation.quantity; index += 1) await ctx.db.insert("tradeReservations", { ...data, collectionEntryId: ids[commitmentOffset++]!, quantity: 1 });
  }
  let placementOffset = 0;
  for (const placement of placements) {
    const { _id: placementId, _creationTime: _, ...data } = placement;
    await ctx.db.patch(placementId, { collectionEntryId: ids[placementOffset++]!, quantity: 1 });
    for (let index = 1; index < placement.quantity; index += 1) await ctx.db.insert("storagePlacements", { ...data, collectionEntryId: ids[placementOffset++]!, quantity: 1 });
  }
  for (const opened of openedCards) {
    const { _id: openedId, _creationTime: _, ...data } = opened;
    // Proceeds belong to the old row as a whole. Allocate its cents, including
    // any remainder, instead of copying the aggregate amount to every copy.
    const cents = opened.realizedProceeds === undefined ? undefined : Math.round(opened.realizedProceeds * 100);
    const proceeds = (index: number) => cents === undefined ? undefined
      : (Math.floor(cents / ids.length) + (index < cents % ids.length ? 1 : 0)) / 100;
    await ctx.db.patch(openedId, { quantity: 1, realizedProceeds: proceeds(0) });
    for (let index = 1; index < ids.length; index += 1) await ctx.db.insert("sealedOpenedCards", {
      ...data, collectionId: ids[index]!, quantity: 1, realizedProceeds: proceeds(index),
    });
  }
  return ids;
}

/** Old responses expanded quantity rows as id#2. Resolve that address to a
 * durable physical ID before editing, so already-open clients remain safe. */
export async function resolvePhysicalCopyId(ctx: MutationCtx, userId: Id<"users">, raw: string) {
  const match = /^(.*)#([1-9][0-9]*)$/.exec(raw);
  const id = ctx.db.normalizeId("collectionEntries", match ? match[1]! : raw);
  if (!id) throw new ConvexError({ code: "NOT_FOUND", message: "Collection copy not found" });
  const entry = await ctx.db.get(id);
  const ordinal = match ? Number(match[2]) : 1;
  if (!Number.isSafeInteger(ordinal) || ordinal > 500) throw new ConvexError({ code: "NOT_FOUND", message: "Collection copy not found" });
  if (entry && entry.userId !== userId) throw new ConvexError({ code: "NOT_FOUND", message: "Collection copy not found" });
  if (entry && entry.quantity > 1) await normalizePhysicalCopies(ctx, entry);
  if (ordinal === 1) {
    if (!entry) throw new ConvexError({ code: "NOT_FOUND", message: "Collection copy not found" });
    return id;
  }
  const copy = await ctx.db.query("collectionEntries").withIndex("by_legacy_source_and_ordinal", q => q.eq("legacyQuantitySourceId", id).eq("legacyQuantityOrdinal", ordinal)).unique();
  if (!copy || copy.userId !== userId) throw new ConvexError({ code: "NOT_FOUND", message: "Collection copy not found" });
  return copy._id;
}
