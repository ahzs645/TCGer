import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCatalogCorrections,
  collectionFacetOptions,
  groupCollectionCards,
  getGameDefinition,
  matchesCollectionFacets,
  type CatalogCorrection,
  type CollectionFacetCard,
  type CollectionCard,
} from "@tcg/api-types";

const darkMagician: CollectionFacetCard = {
  name: "Dark Magician",
  setCode: "LOB-EN005",
  rarity: "Ultra Rare",
  quantity: 3,
  attributes: {
    type: "Normal Monster",
    race: "Spellcaster",
    attribute: "DARK",
    level: 7,
    archetype: "Dark Magician",
    atk: 2500,
    def: 2100,
  },
  copies: [
    { condition: "NM", language: "EN", edition: "1st Edition" },
    { condition: "LP", language: "FR", edition: "Unlimited" },
  ],
};

test("Yu-Gi-Oh collection facets are declared by the game definition", () => {
  const definition = getGameDefinition("yugioh");
  assert.deepEqual(
    definition.collection.identityModes.map((mode) => mode.id),
    ["consolidated", "collector"],
  );
  assert.ok(definition.collection.facets.some((facet) => facet.property === "attributes.atk"));
  assert.ok(definition.collection.facets.some((facet) => facet.property === "copies.language"));
});

test("game facets evaluate card, copy, and aggregate properties", () => {
  const facets = getGameDefinition("yugioh").collection.facets;
  assert.equal(
    matchesCollectionFacets(darkMagician, facets, {
      attribute: ["DARK"],
      race: ["Spellcaster"],
      level: { min: 7, max: 7 },
      atk: { min: 2400 },
      language: ["FR"],
      "owned-quantity": { min: 3 },
    }),
    true,
  );
  assert.equal(matchesCollectionFacets(darkMagician, facets, { def: { min: 2200 } }), false);
});

test("dynamic facet options are discovered from owned cards", () => {
  const race = getGameDefinition("yugioh").collection.facets.find((facet) => facet.id === "race")!;
  assert.deepEqual(collectionFacetOptions([darkMagician], race), [
    { value: "Spellcaster", label: "Spellcaster" },
  ]);
});

test("printing corrections override identity corrections without mutating the input", () => {
  const card = {
    tcg: "yugioh" as const,
    externalId: "print-1",
    baseExternalId: "46986414",
    printingKey: "yugioh:print:lob-en005",
    name: "Dark Magican",
    rarity: "Rare",
    attributes: { archetype: "Dark Magician", atk: 2400 },
  };
  const corrections: CatalogCorrection[] = [
    {
      id: "identity",
      tcg: "yugioh",
      targetType: "identity",
      targetKey: "46986414",
      revision: 1,
      action: "upsert",
      patch: { name: "Dark Magician", attributes: { atk: 2500 } },
      reason: "Provider typo",
      createdBy: "admin",
      createdAt: "2026-08-29T00:00:00.000Z",
    },
    {
      id: "printing",
      tcg: "yugioh",
      targetType: "printing",
      targetKey: "yugioh:print:lob-en005",
      revision: 1,
      action: "upsert",
      patch: { rarity: "Ultra Rare" },
      reason: "Printing rarity",
      createdBy: "admin",
      createdAt: "2026-08-29T00:01:00.000Z",
    },
  ];
  const corrected = applyCatalogCorrections(card, corrections);
  assert.equal(corrected.name, "Dark Magician");
  assert.equal(corrected.rarity, "Ultra Rare");
  assert.equal(corrected.attributes?.atk, 2500);
  assert.equal(card.name, "Dark Magican");
  assert.equal(card.attributes.atk, 2400);
});

test("consolidated collection groups exact printings by gameplay identity", () => {
  const printing = (id: string, setCode: string, quantity: number, price: number): CollectionCard => ({
    id,
    cardId: id,
    externalId: id,
    baseExternalId: "46986414",
    name: "Dark Magician",
    tcg: "yugioh",
    setCode,
    setName: setCode,
    quantity,
    price,
    copies: [],
  });
  const groups = groupCollectionCards([
    printing("lob-en005", "LOB", 2, 12),
    printing("sdy-006", "SDY", 1, 4),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.totalQuantity, 3);
  assert.equal(groups[0]?.totalValue, 28);
  assert.deepEqual(groups[0]?.printings.map((card) => card.setCode), ["LOB", "SDY"]);
});
