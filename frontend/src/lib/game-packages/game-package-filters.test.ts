import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

test("Codex Critters is a complete importable unknown-game fixture", () => {
  const fixtureDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../docs/scanner-system/examples/codex-critters",
  );
  const manifest = gamePackageManifestSchema.parse(
    JSON.parse(readFileSync(resolve(fixtureDirectory, "codex-critters.game-package.json"), "utf8")),
  );
  const catalogBytes = readFileSync(resolve(fixtureDirectory, manifest.catalog.asset.url));
  const catalog = JSON.parse(catalogBytes.toString("utf8")) as {
    formatVersion: number;
    tcg: string;
    sets: unknown[];
    cards: GamePackageCatalogCard[];
  };

  assert.equal(manifest.game.id, "codex-critters");
  assert.equal(manifest.scanner, undefined);
  assert.equal(manifest.offlinePacks, undefined);
  assert.equal(catalogBytes.byteLength, manifest.catalog.asset.bytes);
  assert.equal(createHash("sha256").update(catalogBytes).digest("hex"), manifest.catalog.asset.sha256);
  assert.equal(catalog.formatVersion, 1);
  assert.equal(catalog.tcg, manifest.game.id);
  assert.equal(catalog.cards.length, manifest.catalog.cardCount);
  assert.equal(catalog.sets.length, manifest.catalog.setCount);
  assert.equal(new Set(catalog.cards.map((card) => card.id)).size, catalog.cards.length);
  assert.deepEqual(new Set(manifest.filters.map((filter) => filter.type)), new Set(["select", "multiSelect", "numberRange", "boolean", "text"]));

  const filtered = catalog.cards.filter((card) => matchesGamePackageFilters(card, manifest.filters, {
    faction: ["sky"],
    rarity: "epic",
    cost: { min: 7, max: 7 },
    foilable: true,
    "card-name": "oracle",
  }));
  assert.deepEqual(filtered.map((card) => card.name), ["Mooncrumb Oracle"]);
});
