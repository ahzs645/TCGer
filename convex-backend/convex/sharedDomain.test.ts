import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import { createTestConvex } from "./test.setup";
import { previewCollectionImportSource } from "./lib/collectionImport";

async function seed(t: ReturnType<typeof createTestConvex>) {
  return await t.run(async ctx => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      authSubject: "shared-domain-user", isAdmin: false, showCardNumbers: true, showPricing: true,
      enabledYugioh: true, enabledMagic: true, enabledPokemon: true, createdAt: now, updatedAt: now,
    });
    const binderId = await ctx.db.insert("binders", { userId, kind: "binder", name: "Main", createdAt: now, updatedAt: now });
    return { userId, binderId };
  });
}

describe("shared physical collection domain", () => {
  test("enforces slot capacity and duplicate-print stacking", async () => {
    const t = createTestConvex(); const { binderId } = await seed(t);
    const rapid = await t.mutation(internal.collectionOperations.rapidSetEntry, {
      subject: "shared-domain-user", binderId, tcg: "pokemon", setCode: "sv1",
      entries: [
        { rowId: "a", collectorNumber: "1", card: { tcg: "pokemon", externalId: "sv1-1", name: "Sprigatito", setCode: "sv1", collectorNumber: "1" } },
        { rowId: "b", collectorNumber: "1", card: { tcg: "pokemon", externalId: "sv1-1", name: "Sprigatito", setCode: "sv1", collectorNumber: "1" } },
      ],
    });
    const container = await t.mutation(internal.storage.createContainer, { subject: "shared-domain-user", name: "Binder", kind: "binder", binderId });
    const compartment = await t.mutation(internal.storage.createCompartment, { subject: "shared-domain-user", containerId: container.id, label: "Page 1", order: 1, pageNumber: 1, rows: 1, columns: 1, capacity: 1 });
    await t.mutation(internal.storage.place, { subject: "shared-domain-user", compartmentId: compartment.id, collectionEntryId: rapid.items[0]!.entryId, slotIndex: 0, quantity: 1 });
    await expect(t.mutation(internal.storage.place, { subject: "shared-domain-user", compartmentId: compartment.id, collectionEntryId: rapid.items[1]!.entryId, slotIndex: 0, quantity: 1 })).rejects.toThrow("Slot is occupied");
    await t.mutation(internal.storage.place, { subject: "shared-domain-user", compartmentId: compartment.id, collectionEntryId: rapid.items[1]!.entryId, slotIndex: 0, quantity: 1, allowDuplicateStacking: true });
    const listed = await t.query(internal.storage.list, { subject: "shared-domain-user" });
    expect(listed[0]!.compartments[0]!.placements).toHaveLength(2);
  });

  test("checks out concrete copies and refuses simultaneous over-allocation", async () => {
    const t = createTestConvex(); const { userId, binderId } = await seed(t);
    const ids = await t.run(async ctx => {
      const now = Date.now();
      const cardId = await ctx.db.insert("cards", { tcg: "pokemon", externalId: "sv1-1", name: "Sprigatito", createdAt: now, updatedAt: now });
      await ctx.db.insert("collectionEntries", { userId, binderId, cardId, quantity: 1, createdAt: now, updatedAt: now });
      const firstDeck = await ctx.db.insert("decks", { userId, name: "First", tcg: "pokemon", isPublic: false, createdAt: now, updatedAt: now });
      const secondDeck = await ctx.db.insert("decks", { userId, name: "Second", tcg: "pokemon", isPublic: false, createdAt: now, updatedAt: now });
      await ctx.db.insert("deckCards", { deckId: firstDeck, externalId: "sv1-1", tcg: "pokemon", name: "Sprigatito", quantity: 1, zone: "main", isCommander: false, isSideboard: false });
      await ctx.db.insert("deckCards", { deckId: secondDeck, externalId: "sv1-1", tcg: "pokemon", name: "Sprigatito", quantity: 1, zone: "main", isCommander: false, isSideboard: false });
      return { firstDeck, secondDeck };
    });
    const checkout = await t.mutation(internal.deckCheckouts.checkout, { subject: "shared-domain-user", deckId: ids.firstDeck });
    expect(checkout.allocations).toHaveLength(1);
    await expect(t.mutation(internal.deckCheckouts.checkout, { subject: "shared-domain-user", deckId: ids.secondDeck })).rejects.toThrow("Not enough available copies");
    const checkedIn = await t.mutation(internal.deckCheckouts.checkin, { subject: "shared-domain-user", deckId: ids.firstDeck });
    expect(checkedIn.status).toBe("checked_in");
  });

  test("uses deterministic exact-cent cost allocation with an auditable receipt", async () => {
    const t = createTestConvex(); const { binderId } = await seed(t);
    const rapid = await t.mutation(internal.collectionOperations.rapidSetEntry, { subject: "shared-domain-user", binderId, tcg: "pokemon", setCode: "sv1", entries: [
      { rowId: "a", collectorNumber: "1", card: { tcg: "pokemon", externalId: "sv1-1", name: "A", setCode: "sv1", collectorNumber: "1" } },
      { rowId: "b", collectorNumber: "2", card: { tcg: "pokemon", externalId: "sv1-2", name: "B", setCode: "sv1", collectorNumber: "2" } },
      { rowId: "c", collectorNumber: "3", card: { tcg: "pokemon", externalId: "sv1-3", name: "C", setCode: "sv1", collectorNumber: "3" } },
    ] });
    const result = await t.mutation(internal.collectionOperations.splitAcquisitionCost, { subject: "shared-domain-user", totalCents: 1000, currency: "cad", mode: "equal", lines: rapid.items.map(item => ({ collectionEntryId: item.entryId })) });
    expect(result.allocations.map(row => row.allocatedCents).sort()).toEqual([333, 333, 334]);
    expect(result.allocations.reduce((sum, row) => sum + row.allocatedCents, 0)).toBe(1000);
    expect(result.currency).toBe("CAD");
  });
});

describe("collection import source parity", () => {
  test("accepts JSON content and applies exact-printing resolutions", () => {
    const preview = previewCollectionImportSource({ content: JSON.stringify([{ tcg: "magic", name: "Sol Ring", quantity: 2 }]), format: "json", resolutions: { "1": { externalId: "cmm-1", printingKey: "magic:cmm-1" } } });
    expect(preview.valid).toBe(true);
    expect(preview.rows[0]).toMatchObject({ externalId: "cmm-1", printingKey: "magic:cmm-1", quantity: 2 });
  });
});
