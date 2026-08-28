import assert from "node:assert/strict";
import test from "node:test";

import {
  gamePackageManifestSchema,
  matchesGamePackageFilters,
  type GamePackageCatalogCard,
  type GamePackageFilter,
} from "@tcg/api-types";

const card: GamePackageCatalogCard = {
  id: "demo-1",
  name: "Azure Example",
  rarity: "Rare",
  attributes: { faction: ["water", "hero"], cost: 3, foil: true },
};

test("game filters combine controls with AND and multi-select values with OR", () => {
  const filters: GamePackageFilter[] = [
    { id: "faction", label: "Faction", property: "attributes.faction", type: "multiSelect", options: [{ value: "water", label: "Water" }, { value: "fire", label: "Fire" }] },
    { id: "cost", label: "Cost", property: "attributes.cost", type: "numberRange", min: 0, max: 10 },
  ];
  assert.equal(matchesGamePackageFilters(card, filters, { faction: ["fire", "water"], cost: { min: 2, max: 4 } }), true);
  assert.equal(matchesGamePackageFilters(card, filters, { faction: ["water"], cost: { min: 4 } }), false);
});

test("manifest filters reject executable or unrestricted property paths", () => {
  const base = {
    schema: "https://tcger.app/schemas/game-package-manifest/v1",
    packageVersion: "1",
    publishedAt: "2026-08-27T00:00:00Z",
    game: { id: "demo", name: "Demo" },
    publisher: { name: "Publisher" },
    catalog: { schema: "tcger-catalog-v1", asset: { url: "catalog.json", bytes: 1, sha256: "0".repeat(64) }, cardCount: 0 },
  } as const;
  assert.equal(gamePackageManifestSchema.safeParse({ ...base, filters: [{ id: "unsafe", label: "Unsafe", property: "constructor.prototype", type: "text" }] }).success, false);
  assert.equal(gamePackageManifestSchema.safeParse({ ...base, filters: [{ id: "safe", label: "Safe", property: "attributes.faction", type: "text" }] }).success, true);
});
