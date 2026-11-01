import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { previewCollectionImport } from "./lib/collectionImport";
import { createTestConvex, TEST_BRIDGE_SECRET } from "./test.setup";
function headers(subject = "inventory-owner") {
  return { Authorization: "Bearer test", "Content-Type": "application/json", "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
    "x-tcger-user-id": subject, "x-tcger-user-email": `${subject}@example.com` };
}
async function seed(t: ReturnType<typeof createTestConvex>, quantity = 1) {
  return await t.run(async ctx => {
    const common = { isAdmin: false, showCardNumbers: true, showPricing: true, enabledMagic: true, enabledPokemon: true, enabledYugioh: true, createdAt: 1, updatedAt: 1 };
    const userId = await ctx.db.insert("users", { ...common, authSubject: "inventory-owner" });
    await ctx.db.insert("users", { ...common, authSubject: "inventory-receiver" });
    const binderId = await ctx.db.insert("binders", { userId, kind: "binder", name: "Inventory", createdAt: 1, updatedAt: 1 });
    const cardId = await ctx.db.insert("cards", { tcg: "magic", externalId: "print-a", name: "Card A", createdAt: 1, updatedAt: 1 });
    const entryId = await ctx.db.insert("collectionEntries", { userId, binderId, cardId, quantity, condition: "LP", notes: "original", price: 15,
      acquisitionPrice: 5, acquisitionCurrency: "USD", serialNumber: "serial-a", imageUrls: ["https://example.com/photo.jpg"], createdAt: 1, updatedAt: 1 });
    return { userId, binderId, cardId, entryId };
  });
}
function post(t: ReturnType<typeof createTestConvex>, path: string, body: unknown, subject?: string) {
  return t.fetch(path, { method: "POST", headers: headers(subject), body: JSON.stringify(body) });
}
describe("physical-copy integrity and replayable operations", () => {
  test("currency summary includes every row at the limit and rejects partial totals above it", async () => {
    const t = createTestConvex(); const ids = await seed(t);
    await t.run(async ctx => {
      for (let index = 0; index < 5000; index++) {
        await ctx.db.insert("transactions", { userId: ids.userId, type: "sale", quantity: 1, amount: 1,
          currency: index % 2 === 0 ? "USD" : "CAD", date: index, createdAt: index, updatedAt: index });
      }
    });
    expect(await t.query(internal.finance.getSummaryByCurrency, { subject: "inventory-owner" })).toEqual({
      byCurrency: [
        { currency: "CAD", totalSpent: 0, totalEarned: 2500, profitLoss: 2500 },
        { currency: "USD", totalSpent: 0, totalEarned: 2500, profitLoss: 2500 },
      ], transactionCount: 5000,
    });
    await t.run(ctx => ctx.db.insert("transactions", { userId: ids.userId, type: "sale", quantity: 1, amount: 100,
      currency: "EUR", date: 5001, createdAt: 5001, updatedAt: 5001 }));
    const response = await t.fetch("/finance/summary/by-currency", { headers: headers() });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "LIMIT_EXCEEDED" });
  }, 15000);
  test("printing correction and single-copy deletion preserve every sibling field", async () => {
    const t = createTestConvex(); const ids = await seed(t);
    const sibling = await t.run(ctx => ctx.db.insert("collectionEntries", { userId: ids.userId, binderId: ids.binderId, cardId: ids.cardId,
      quantity: 1, condition: "NM", notes: "keep this", price: 42, acquisitionPrice: 9, acquisitionCurrency: "CAD", serialNumber: "keep-serial", createdAt: 1, updatedAt: 1 }));
    const before = await t.run(ctx => ctx.db.get(sibling));
    expect((await t.fetch(`/collections/${ids.binderId}/cards/${ids.entryId}`, { method: "PATCH", headers: headers(), body: JSON.stringify({
      cardOverride: { cardId: "print-b", cardData: { tcg: "magic", externalId: "print-b", name: "Card B" } },
    }) })).status).toBe(200);
    expect(await t.run(ctx => ctx.db.get(sibling))).toEqual(before);
    expect((await t.fetch(`/collections/${ids.binderId}/copies/${ids.entryId}`, { method: "DELETE", headers: headers() })).status).toBe(204);
    expect(await t.run(ctx => ctx.db.get(ids.entryId))).toBeNull();
    expect(await t.run(ctx => ctx.db.get(sibling))).toEqual(before);
  });
  test("rapid intake creates physical rows and metadata-only PATCH preserves all three", async () => {
    const t = createTestConvex(); const ids = await seed(t);
    const rapid = await t.mutation(internal.collectionOperations.rapidSetEntry, { subject: "inventory-owner", binderId: ids.binderId, tcg: "pokemon", setCode: "sv1",
      entries: [{ rowId: "three", collectorNumber: "1", quantity: 3, card: { tcg: "pokemon", externalId: "sv1-1", name: "Three", setCode: "sv1", collectorNumber: "1" } }] });
    expect(rapid.items[0]!.entryIds).toHaveLength(3);
    expect((await t.fetch(`/collections/${ids.binderId}/cards/${rapid.items[0]!.entryId}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ notes: "reviewed" }) })).status).toBe(200);
    const rows = await t.run(ctx => ctx.db.query("collectionEntries").collect());
    expect(rows).toHaveLength(4); expect(rows.every(row => row.quantity === 1)).toBe(true);
    expect(rows.filter(row => row.notes === "reviewed")).toHaveLength(1);
  });
  test("legacy migration preserves photos, tags, storage, original ID and exact count", async () => {
    const t = createTestConvex(); const ids = await seed(t, 3);
    await t.run(async ctx => {
      const tag = await ctx.db.insert("tags", { userId: ids.userId, label: "Keep", colorHex: "123456", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("collectionEntryTags", { entryId: ids.entryId, tagId: tag, assignedAt: 1 });
    });
    const container = await t.mutation(internal.storage.createContainer, { subject: "inventory-owner", name: "Box", kind: "box", binderId: ids.binderId });
    const compartment = await t.mutation(internal.storage.createCompartment, { subject: "inventory-owner", containerId: container.id, label: "A", order: 1, rows: 1, columns: 1, capacity: 1 });
    await t.mutation(internal.storage.place, { subject: "inventory-owner", compartmentId: compartment.id, collectionEntryId: ids.entryId, quantity: 3, slotIndex: 0 });
    expect(await t.mutation(internal.collectionOperations.normalizeLegacyCopies, { subject: "inventory-owner", dryRun: true })).toMatchObject({ normalizedRows: 1, createdCopies: 2 });
    expect((await t.run(ctx => ctx.db.get(ids.entryId)))?.quantity).toBe(3);
    const migrated = await t.mutation(internal.collectionOperations.normalizeLegacyCopies, { subject: "inventory-owner", dryRun: false });
    expect(migrated.entryIds).toHaveLength(3); expect(migrated.entryIds).toContain(ids.entryId);
    const state = await t.run(async ctx => ({ entries: await ctx.db.query("collectionEntries").collect(), tags: await ctx.db.query("collectionEntryTags").collect(), placements: await ctx.db.query("storagePlacements").collect() }));
    for (const row of state.entries) expect(row).toMatchObject({ quantity: 1, condition: "LP", acquisitionPrice: 5, acquisitionCurrency: "USD", serialNumber: "serial-a", notes: "original", imageUrls: ["https://example.com/photo.jpg"] });
    expect(state.tags).toHaveLength(3); expect(state.placements).toHaveLength(3); expect(new Set(state.placements.map(row => row.collectionEntryId)).size).toBe(3);
    expect(await t.mutation(internal.collectionOperations.normalizeLegacyCopies, { subject: "inventory-owner", dryRun: false })).toMatchObject({ normalizedRows: 0, createdCopies: 0, remaining: false });
  });
  test("normalization preserves exact sealed proceeds and their original currency", async () => {
    const t = createTestConvex(); const ids = await seed(t, 3);
    const openingId = await t.run(async ctx => {
      const productId = await ctx.db.insert("sealedProducts", { catalogKey: "legacy-pack", tcg: "magic", name: "Pack", productType: "booster", createdAt: 1, updatedAt: 1 });
      const inventoryId = await ctx.db.insert("sealedInventory", { userId: ids.userId, productId, quantity: 0, purchasePrice: 20, createdAt: 1, updatedAt: 1 });
      const openingId = await ctx.db.insert("sealedOpenings", { userId: ids.userId, sealedInventoryId: inventoryId, openedQuantity: 1, openedAt: 1, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("sealedOpenedCards", { userId: ids.userId, openingId, collectionId: ids.entryId, externalId: "print-a", tcg: "magic", cardName: "Card A", quantity: 3, status: "sold", realizedProceeds: 10, realizedCurrency: "CAD", soldAt: 2, createdAt: 1, updatedAt: 2 });
      return openingId;
    });
    await t.mutation(internal.collectionOperations.normalizeLegacyCopies, { subject: "inventory-owner", dryRun: false });
    const rows = await t.run(ctx => ctx.db.query("sealedOpenedCards").withIndex("by_opening", q => q.eq("openingId", openingId)).collect());
    expect(rows.map(row => row.realizedProceeds).sort()).toEqual([3.33, 3.33, 3.34]);
    expect(rows.every(row => row.quantity === 1 && row.realizedCurrency === "CAD")).toBe(true);
    expect((await t.query(internal.sealed.listOpeningLedgers, { subject: "inventory-owner" }))[0]).toMatchObject({ soldCopies: 3, realizedProceeds: 0, realizedProceedsByCurrency: [{ currency: "CAD", amount: 10 }], profitLoss: -20 });
  });
  test("normalization defaults to preview and rejects an oversized row without partial writes", async () => {
    const t = createTestConvex(); const ids = await seed(t, 3);
    const preview = await t.mutation(internal.collectionOperations.normalizeLegacyCopies, { subject: "inventory-owner" });
    expect(preview).toMatchObject({ dryRun: true, normalizedRows: 1, createdCopies: 2, remaining: true, entryIds: [ids.entryId, `${ids.entryId}#2`, `${ids.entryId}#3`] });
    expect((await t.run(ctx => ctx.db.get(ids.entryId)))?.quantity).toBe(3);
    await t.run(ctx => ctx.db.patch(ids.entryId, { quantity: 501 }));
    await expect(t.mutation(internal.collectionOperations.normalizeLegacyCopies, { subject: "inventory-owner", dryRun: false })).rejects.toThrow(/500-copy/);
    expect((await t.run(ctx => ctx.db.get(ids.entryId)))?.quantity).toBe(501);
  });
  test("deleting a legacy copy photo preserves the shared blob and sibling photo metadata", async () => {
    const t = createTestConvex(); const ids = await seed(t);
    await t.run(ctx => ctx.db.patch(ids.entryId, { imageUrls: [] }));
    const form = new FormData(); form.append("images", new Blob(["photo"], { type: "image/jpeg" }), "copy.jpg");
    const requestHeaders = headers(); delete (requestHeaders as Record<string, string>)["Content-Type"];
    const upload = await t.fetch(`/collections/${ids.binderId}/cards/${ids.entryId}/images`, { method: "POST", headers: requestHeaders, body: form });
    expect(upload.status).toBe(201);
    await t.run(ctx => ctx.db.patch(ids.entryId, { quantity: 3 }));
    const before = await t.run(ctx => ctx.db.get(ids.entryId));
    const removed = await t.fetch(`/collections/${ids.binderId}/cards/${encodeURIComponent(`${ids.entryId}#2`)}/images/0`, { method: "DELETE", headers: headers() });
    expect(removed.status).toBe(204);
    const copies = await t.run(ctx => ctx.db.query("collectionEntries").collect());
    expect(copies).toHaveLength(3); expect(copies.filter(copy => copy.imageUrls?.length === 0)).toHaveLength(1);
    const untouched = copies.filter(copy => copy.imageUrls?.length === 1);
    expect(untouched).toHaveLength(2);
    for (const copy of untouched) expect(copy.imageStorageIds).toEqual(before?.imageStorageIds);
    expect(await t.run(ctx => ctx.storage.getUrl(before!.imageStorageIds![0]!))).not.toBeNull();
  });
  test("CAD allocation stays CAD and undo reverses purchases and totals exactly once", async () => {
    const t = createTestConvex(); const ids = await seed(t);
    const split = await t.mutation(internal.collectionOperations.splitAcquisitionCost, { subject: "inventory-owner", operationId: "allocation-1", totalCents: 10000, currency: "cad", mode: "equal", lines: [{ collectionEntryId: ids.entryId }] });
    expect(await t.mutation(internal.collectionOperations.splitAcquisitionCost, { subject: "inventory-owner", operationId: "allocation-1", totalCents: 10000, currency: "cad", mode: "equal", lines: [{ collectionEntryId: ids.entryId }] })).toEqual(split);
    await expect(t.mutation(internal.collectionOperations.splitAcquisitionCost, { subject: "inventory-owner", operationId: "allocation-1", totalCents: 12000, currency: "cad", mode: "equal", lines: [{ collectionEntryId: ids.entryId }] })).rejects.toThrow(/different payload/);
    expect(await t.run(ctx => ctx.db.get(ids.entryId))).toMatchObject({ acquisitionPrice: 100, acquisitionCurrency: "CAD" });
    await expect(t.mutation(internal.collectionOperations.splitAcquisitionCost, { subject: "inventory-owner", operationId: "different-allocation", totalCents: 12000, currency: "CAD", mode: "equal", lines: [{ collectionEntryId: ids.entryId }] })).rejects.toThrow(/already has a purchase/);
    expect(await t.query(internal.finance.getRealizedPerformance, { subject: "inventory-owner" })).toMatchObject({ inventoryCost: 0, inventoryCurrency: "USD", inventoryCostsByCurrency: [{ currency: "CAD", cost: 100 }] });
    const input = { subject: "inventory-owner", auditId: split.auditId, idempotencyKey: "reverse-cad" };
    const first = await t.mutation(internal.bridge.undoCollectionMutation, input);
    expect((await t.mutation(internal.bridge.undoCollectionMutation, input)).id).toBe(first.id);
    expect(await t.run(ctx => ctx.db.get(ids.entryId))).toMatchObject({ acquisitionPrice: 5, acquisitionCurrency: "USD" });
    expect(await t.run(ctx => ctx.db.query("transactions").collect())).toHaveLength(0);
    expect(await t.query(internal.finance.getSummary, { subject: "inventory-owner" })).toMatchObject({ totalSpent: 0, transactionCount: 0 });
  });
  test("mixed USD, CAD and unknown costs stay separate and unknown sale basis is not inferred", async () => {
    const t = createTestConvex(); const ids = await seed(t);
    const input = { operationId: "mixed-costs", source: "scanner", rows: [
      { rowId: "cad", cardId: "cad-card", cardData: { tcg: "magic", externalId: "cad-card", name: "CAD" }, acquisitionPrice: 10, acquisitionCurrency: "CAD", price: 40 },
      { rowId: "unknown", cardId: "unknown-card", cardData: { tcg: "magic", externalId: "unknown-card", name: "Unknown" }, acquisitionPrice: 7, price: 22 },
    ] };
    const intake = await post(t, `/collections/${ids.binderId}/intake`, input); expect(intake.status).toBe(201);
    const receipt = await intake.json(); const unknownId = receipt.rows.find((row: { rowId: string }) => row.rowId === "unknown").entryIds[0] as Id<"collectionEntries">;
    expect((await t.run(ctx => ctx.db.get(unknownId)))!.acquisitionCurrency).toBeUndefined();
    expect(await t.query(internal.finance.getRealizedPerformance, { subject: "inventory-owner" })).toMatchObject({ inventoryCost: 5, inventoryMarketValue: 77, inventoryCostsByCurrency: [{ currency: "CAD", cost: 10 }, { currency: "UNKNOWN", cost: 7 }, { currency: "USD", cost: 5 }] });
    const sale = await post(t, "/finance/sales", { operationId: "unknown-cost-sale", collectionId: ids.binderId, copyIds: [unknownId], amount: 30, currency: "USD", removeFromInventory: false });
    expect(sale.status).toBe(201);
    expect((await t.run(ctx => ctx.db.query("transactions").collect()))[0]!.costBasis).toBeUndefined();
  });
  test("CSV import and export retain CAD and leave unknown acquisition currency blank", async () => {
    const t = createTestConvex(); const ids = await seed(t);
    const csv = "tcg,external_id,card_name,acquisition_price,acquisition_currency\nmagic,cad-copy,CAD copy,10,CAD\nmagic,unknown-copy,Unknown copy,20,";
    const imported = await post(t, "/collections/import/commit", { csv, options: { defaultBinderId: ids.binderId } });
    expect(imported.status).toBe(201);
    const exported = await t.fetch("/collections/export?format=csv", { headers: headers() }); expect(exported.status).toBe(200);
    const roundTrip = previewCollectionImport(await exported.text()); expect(roundTrip.valid).toBe(true);
    expect(roundTrip.rows.find(row => row.externalId === "cad-copy")).toMatchObject({ acquisitionPrice: 10, acquisitionCurrency: "CAD" });
    const unknown = roundTrip.rows.find(row => row.externalId === "unknown-copy");
    expect(unknown).toMatchObject({ acquisitionPrice: 20 }); expect(unknown?.acquisitionCurrency).toBeUndefined();
  });
  test("removal undo restores storage, acquisition and opening references atomically", async () => {
    const t = createTestConvex(); const ids = await seed(t);
    const purchase = await t.mutation(internal.finance.createTransaction, { subject: "inventory-owner", type: "purchase", collectionEntryId: ids.entryId, amount: 55, currency: "CAD" });
    const container = await t.mutation(internal.storage.createContainer, { subject: "inventory-owner", name: "Undo box", kind: "box" });
    const compartment = await t.mutation(internal.storage.createCompartment, { subject: "inventory-owner", containerId: container.id, label: "Slot", order: 1, rows: 1, columns: 1, capacity: 1 });
    await t.mutation(internal.storage.place, { subject: "inventory-owner", compartmentId: compartment.id, collectionEntryId: ids.entryId, quantity: 1, slotIndex: 0 });
    const openedId = await t.run(async ctx => {
      const productId = await ctx.db.insert("sealedProducts", { catalogKey: "undo-pack", tcg: "magic", name: "Pack", productType: "booster", createdAt: 1, updatedAt: 1 });
      const inventoryId = await ctx.db.insert("sealedInventory", { userId: ids.userId, productId, quantity: 0, createdAt: 1, updatedAt: 1 });
      const openingId = await ctx.db.insert("sealedOpenings", { userId: ids.userId, sealedInventoryId: inventoryId, openedQuantity: 1, openedAt: 1, createdAt: 1, updatedAt: 1 });
      return ctx.db.insert("sealedOpenedCards", { userId: ids.userId, openingId, collectionId: ids.entryId, externalId: "print-a", tcg: "magic", cardName: "Card A", quantity: 1, status: "active", createdAt: 1, updatedAt: 1 });
    });
    await t.mutation(internal.collectionOperations.removeCopy, { subject: "inventory-owner", binderId: ids.binderId, entryId: ids.entryId });
    const audit = await t.run(async ctx => (await ctx.db.query("collectionMutationAudits").collect()).find(row => row.operationKind === "remove")!);
    const replacement = await t.run(async ctx => {
      const cardId = await ctx.db.insert("cards", { tcg: "magic", externalId: "replacement", name: "Replacement", createdAt: 1, updatedAt: 1 });
      return ctx.db.insert("collectionEntries", { userId: ids.userId, binderId: ids.binderId, cardId, quantity: 1, createdAt: 1, updatedAt: 1 });
    });
    const occupied = await t.mutation(internal.storage.place, { subject: "inventory-owner", compartmentId: compartment.id, collectionEntryId: replacement, quantity: 1, slotIndex: 0 });
    const undo = { subject: "inventory-owner", auditId: audit._id, idempotencyKey: "restore-placed-copy" };
    await expect(t.mutation(internal.bridge.undoCollectionMutation, undo)).rejects.toThrow(/slot has been reassigned/);
    expect((await t.run(ctx => ctx.db.get(purchase.id)))!.collectionEntryId).toBe(ids.entryId);
    expect(await t.run(ctx => ctx.db.query("collectionEntries").collect())).toHaveLength(1);
    await t.mutation(internal.storage.removePlacement, { subject: "inventory-owner", placementId: occupied.id });
    await t.mutation(internal.bridge.undoCollectionMutation, undo);
    const restored = await t.run(async ctx => (await ctx.db.query("collectionEntries").collect()).find(row => row._id !== replacement)!);
    expect(restored).toMatchObject({ acquisitionPrice: 55, acquisitionCurrency: "CAD", acquisitionTransactionId: purchase.id });
    expect((await t.run(ctx => ctx.db.get(purchase.id)))!.collectionEntryId).toBe(restored._id);
    expect((await t.run(ctx => ctx.db.get(openedId)))!.collectionId).toBe(restored._id);
    expect((await t.run(ctx => ctx.db.query("storagePlacements").collect()))[0]).toMatchObject({ collectionEntryId: restored._id, compartmentId: compartment.id, slotIndex: 0 });
    await t.mutation(internal.finance.deleteTransaction, { subject: "inventory-owner", transactionId: purchase.id });
    expect((await t.run(ctx => ctx.db.get(restored._id)))!.acquisitionPrice).toBeUndefined();
  });
  test.each(["usd", " usd "])("sale currency %j canonicalizes to USD for receipts, costs and totals", async (currency) => {
    const t = createTestConvex(); const ids = await seed(t);
    const input = { operationId: "canonical-usd-sale", collectionId: ids.binderId, copyIds: [ids.entryId], amount: 25, currency, removeFromInventory: true };
    const response = await post(t, "/finance/sales", input); expect(response.status).toBe(201);
    const receipt = await response.json();
    expect(receipt).toMatchObject({ currency: "USD", amount: 25, copyIds: [ids.entryId], removedCopyIds: [ids.entryId] });
    const replay = await post(t, "/finance/sales", { ...input, currency: "USD" });
    expect(replay.status).toBe(201); expect(await replay.json()).toEqual(receipt);
    const transactions = await t.run(ctx => ctx.db.query("transactions").collect());
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ currency: "USD", amount: 25, costBasis: 5, quantity: 1 });
    expect(await t.query(internal.finance.getSummary, { subject: "inventory-owner" })).toMatchObject({ totalSpent: 0, totalEarned: 25, profitLoss: 25, transactionCount: 1 });
  });
  test("sale commits exact copies once and rejects changed or foreign replay", async () => {
    const t = createTestConvex(); const ids = await seed(t);
    const sibling = await t.run(ctx => ctx.db.insert("collectionEntries", { userId: ids.userId, binderId: ids.binderId, cardId: ids.cardId, quantity: 1, notes: "untouched", createdAt: 1, updatedAt: 1 }));
    const input = { operationId: "sale-1", collectionId: ids.binderId, copyIds: [ids.entryId], amount: 25, currency: "CAD", removeFromInventory: true };
    const response = await post(t, "/finance/sales", input); expect(response.status).toBe(201); const receipt = await response.json();
    expect(await (await post(t, "/finance/sales", input)).json()).toEqual(receipt);
    expect((await post(t, "/finance/sales", { ...input, amount: 26 })).status).toBe(409);
    expect((await post(t, "/finance/sales", input, "inventory-receiver")).status).toBe(404);
    const state = await t.run(async ctx => ({ entries: await ctx.db.query("collectionEntries").collect(), transactions: await ctx.db.query("transactions").collect() }));
    expect(state.entries).toHaveLength(1); expect(state.entries[0]).toMatchObject({ _id: sibling, notes: "untouched" });
    expect(state.transactions).toHaveLength(1); expect(state.transactions[0]).toMatchObject({ amount: 25, currency: "CAD", quantity: 1 });
    expect(state.transactions[0]!.costBasis).toBeUndefined(); expect(receipt.removedCopyIds).toEqual([ids.entryId]);
  });
  test("intake, exact opening links and sealed decrement are atomic and replayable", async () => {
    const t = createTestConvex(); const ids = await seed(t);
    const inventoryId = await t.run(async ctx => {
      const productId = await ctx.db.insert("sealedProducts", { catalogKey: "pack", tcg: "magic", name: "Pack", productType: "booster", createdAt: 1, updatedAt: 1 });
      return ctx.db.insert("sealedInventory", { userId: ids.userId, productId, quantity: 2, createdAt: 1, updatedAt: 1 });
    });
    const input = { operationId: "opening-1", source: "physical-opening", sealedInventoryId: inventoryId, openedQuantity: 3,
      rows: [{ rowId: "pulls", cardId: "print-new", cardData: { tcg: "magic", externalId: "print-new", name: "New pulls" }, quantity: 3 }] };
    expect((await post(t, `/collections/${ids.binderId}/intake`, input)).status).toBe(409);
    expect(await t.run(ctx => ctx.db.query("collectionEntries").collect())).toHaveLength(1);
    input.openedQuantity = 1;
    const response = await post(t, `/collections/${ids.binderId}/intake`, input); expect(response.status).toBe(201);
    const receipt = await response.json(); expect(receipt.entryIds).toHaveLength(3); expect(receipt.entryIds).not.toContain(ids.entryId);
    expect(await (await post(t, `/collections/${ids.binderId}/intake`, input)).json()).toEqual(receipt);
    expect((await post(t, `/collections/${ids.binderId}/intake`, { ...input, rows: [{ ...input.rows[0], quantity: 4 }] })).status).toBe(409);
    const state = await t.run(async ctx => ({ inventory: await ctx.db.get(inventoryId), entries: await ctx.db.query("collectionEntries").collect(), links: await ctx.db.query("sealedOpenedCards").collect(), openings: await ctx.db.query("sealedOpenings").collect() }));
    expect(state.inventory?.quantity).toBe(1); expect(state.entries).toHaveLength(4); expect(state.openings).toHaveLength(1);
    expect(state.links.map(row => row.collectionId).sort()).toEqual([...receipt.entryIds].sort());
    expect((await post(t, `/collections/${ids.binderId}/intake`, { ...input, operationId: "simulation", source: "simulated" })).status).toBe(400);
  });
  test("decks, trades, sales and deletion share the same availability policy", async () => {
    const t = createTestConvex(); const ids = await seed(t);
    const deckId = await t.run(async ctx => {
      const deckId = await ctx.db.insert("decks", { userId: ids.userId, name: "Deck", tcg: "magic", isPublic: false, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("deckCards", { deckId, externalId: "print-a", tcg: "magic", name: "Card A", quantity: 1, zone: "main", isCommander: false, isSideboard: false });
      return deckId;
    });
    const trade = { subject: "inventory-owner", receiverId: "inventory-receiver", senderCards: [{ tcg: "magic", externalId: "print-a", name: "Card A", quantity: 1, collectionEntryId: ids.entryId }], receiverCards: [] };
    await t.mutation(internal.deckCheckouts.checkout, { subject: "inventory-owner", deckId });
    await expect(t.mutation(internal.trades.create, trade)).rejects.toThrow(/Not enough unreserved/);
    expect((await post(t, "/finance/sales", { operationId: "blocked-sale", collectionId: ids.binderId, copyIds: [ids.entryId], amount: 25, currency: "USD", removeFromInventory: true })).status).toBe(409);
    expect((await t.fetch(`/collections/${ids.binderId}/copies/${ids.entryId}`, { method: "DELETE", headers: headers() })).status).toBe(409);
    expect(await t.run(ctx => ctx.db.query("transactions").collect())).toHaveLength(0);
    await t.mutation(internal.deckCheckouts.checkin, { subject: "inventory-owner", deckId }); await t.mutation(internal.trades.create, trade);
    await expect(t.mutation(internal.deckCheckouts.checkout, { subject: "inventory-owner", deckId })).rejects.toThrow(/Not enough available/);
    expect((await t.fetch(`/collections/${ids.binderId}/cards/${ids.entryId}`, { method: "DELETE", headers: headers() })).status).toBe(409);
    expect(await t.run(ctx => ctx.db.get(ids.entryId))).not.toBeNull();
  });
  test("an already-rendered legacy #2 address edits and deletes only its durable physical copy", async () => {
    const t = createTestConvex(); const ids = await seed(t, 3);
    const virtualId = `${ids.entryId}#2`;
    const edited = await t.fetch(`/collections/${ids.binderId}/cards/${encodeURIComponent(virtualId)}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ notes: "second only" }) });
    expect(edited.status).toBe(200);
    const before = await t.run(ctx => ctx.db.query("collectionEntries").collect());
    expect(before).toHaveLength(3); expect(before.filter(row => row.notes === "second only")).toHaveLength(1);
    expect((await t.run(ctx => ctx.db.get(ids.entryId)))?.notes).toBe("original");
    expect((await t.fetch(`/collections/${ids.binderId}/copies/${encodeURIComponent(virtualId)}`, { method: "DELETE", headers: headers() })).status).toBe(204);
    const after = await t.run(ctx => ctx.db.query("collectionEntries").collect());
    expect(after).toHaveLength(2); expect(after.every(row => row.notes === "original" && row.quantity === 1)).toBe(true);
  });
  test("linked purchase creation, editing and removal update copy metadata atomically", async () => {
    const t = createTestConvex(); const ids = await seed(t);
    const body = { type: "purchase", collectionEntryId: ids.entryId, amount: 55, currency: "CAD", quantity: 1, date: "2026-10-01T12:00:00.000Z" };
    const response = await post(t, "/finance/transactions", body); expect(response.status).toBe(201); const transaction = await response.json();
    expect(await (await post(t, "/finance/transactions", body)).json()).toEqual(transaction);
    expect(await t.run(ctx => ctx.db.query("transactions").collect())).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.get(ids.entryId))).toMatchObject({ acquisitionPrice: 55, acquisitionCurrency: "CAD", acquiredAt: body.date });
    expect((await post(t, "/finance/transactions", { ...body, amount: 56 })).status).toBe(409);
    expect((await t.fetch(`/collections/${ids.binderId}/cards/${ids.entryId}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ acquisitionPrice: null, acquisitionCurrency: null }) })).status).toBe(409);
    expect((await t.fetch(`/collections/${ids.binderId}/cards/${ids.entryId}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ notes: "original", acquisitionPrice: 55, acquisitionCurrency: "CAD" }) })).status).toBe(200);
    expect((await post(t, "/finance/transactions", body, "inventory-receiver")).status).toBe(404);
    expect((await t.fetch(`/finance/transactions/${transaction.id}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ quantity: 2 }) })).status).toBe(400);
    expect((await t.fetch(`/finance/transactions/${transaction.id}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ amount: 35, currency: "USD" }) })).status).toBe(200);
    expect(await t.run(ctx => ctx.db.get(ids.entryId))).toMatchObject({ acquisitionPrice: 35, acquisitionCurrency: "USD" });
    expect((await t.fetch(`/finance/transactions/${transaction.id}`, { method: "DELETE", headers: headers() })).status).toBe(204);
    const copy = await t.run(ctx => ctx.db.get(ids.entryId)); expect(copy?.acquisitionPrice).toBeUndefined(); expect(copy?.acquisitionCurrency).toBeUndefined(); expect(copy?.notes).toBe("original");
    expect(await t.query(internal.finance.getSummary, { subject: "inventory-owner" })).toMatchObject({ totalSpent: 0, transactionCount: 0 });
  });

});
