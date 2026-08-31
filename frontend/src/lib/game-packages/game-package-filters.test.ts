import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  GAME_DEFINITIONS,
  duplicateGamePackage,
  gamePackageDefinition,
  gamePackageId,
  gamePackageManifestSchema,
  gamePackageReleaseRelation,
  gameDefinitionSupportsFeature,
  matchesGamePackageFilters,
  POKEDEX_GAME_FEATURE_ID,
  type GamePackageCatalogCard,
  type GamePackageFilter,
} from "@tcg/api-types";
import { needsGameInstallation } from "./game-installation-state";
import { activeGameFeatureSources } from "./active-game-features";

const card: GamePackageCatalogCard = {
  id: "demo-1",
  name: "Azure Example",
  rarity: "Rare",
  attributes: { faction: ["water", "hero"], cost: 3, foil: true },
};

test("game filters combine controls with AND and multi-select values with OR", () => {
  const filters: GamePackageFilter[] = [
    {
      id: "faction",
      label: "Faction",
      property: "attributes.faction",
      type: "multiSelect",
      options: [
        { value: "water", label: "Water" },
        { value: "fire", label: "Fire" },
      ],
    },
    {
      id: "cost",
      label: "Cost",
      property: "attributes.cost",
      type: "numberRange",
      min: 0,
      max: 10,
    },
  ];
  assert.equal(
    matchesGamePackageFilters(card, filters, {
      faction: ["fire", "water"],
      cost: { min: 2, max: 4 },
    }),
    true,
  );
  assert.equal(
    matchesGamePackageFilters(card, filters, {
      faction: ["water"],
      cost: { min: 4 },
    }),
    false,
  );
});

test("manifest filters reject executable or unrestricted property paths", () => {
  const base = {
    schema: "https://tcger.app/schemas/game-package-manifest/v1",
    packageVersion: "1",
    publishedAt: "2026-08-27T00:00:00Z",
    game: { id: "demo", name: "Demo" },
    publisher: { name: "Publisher" },
    catalog: {
      schema: "tcger-catalog-v1",
      asset: { url: "catalog.json", bytes: 1, sha256: "0".repeat(64) },
      cardCount: 0,
    },
  } as const;
  assert.equal(
    gamePackageManifestSchema.safeParse({
      ...base,
      filters: [
        {
          id: "unsafe",
          label: "Unsafe",
          property: "constructor.prototype",
          type: "text",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    gamePackageManifestSchema.safeParse({
      ...base,
      filters: [
        {
          id: "safe",
          label: "Safe",
          property: "attributes.faction",
          type: "text",
        },
      ],
    }).success,
    true,
  );
});

test("sealed product interfaces require a sealed catalog capability", () => {
  const base = {
    schema: "https://tcger.app/schemas/game-package-manifest/v1",
    packageVersion: "1",
    publishedAt: "2026-08-27T00:00:00Z",
    game: { id: "demo", name: "Demo" },
    publisher: { name: "Publisher" },
    catalog: {
      schema: "tcger-catalog-v1",
      asset: { url: "catalog.json", bytes: 1, sha256: "0".repeat(64) },
      cardCount: 0,
    },
    definition: {
      id: "demo",
      label: "Demo",
      interfaces: { sealedProducts: true },
      collection: {
        identityModes: [
          {
            id: "collector",
            label: "Collector",
            description: "Keep printings separate.",
            key: "printingKey",
          },
        ],
        defaultIdentityMode: "collector",
        facets: [],
      },
      search: { facets: [] },
    },
  } as const;
  assert.equal(gamePackageManifestSchema.safeParse(base).success, false);
  assert.equal(
    gamePackageManifestSchema.safeParse({
      ...base,
      sealedProducts: {
        schema: "tcger-sealed-catalog-v1",
        asset: { url: "sealed.json", bytes: 1, sha256: "1".repeat(64) },
        productCount: 0,
      },
    }).success,
    true,
  );
});

test("Codex Critters is a complete importable unknown-game fixture", () => {
  const fixtureDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../docs/scanner-system/examples/codex-critters",
  );
  const manifest = gamePackageManifestSchema.parse(
    JSON.parse(
      readFileSync(
        resolve(fixtureDirectory, "codex-critters.game-package.json"),
        "utf8",
      ),
    ),
  );
  const catalogBytes = readFileSync(
    resolve(fixtureDirectory, manifest.catalog.asset.url),
  );
  const catalog = JSON.parse(catalogBytes.toString("utf8")) as {
    formatVersion: number;
    tcg: string;
    sets: unknown[];
    cards: GamePackageCatalogCard[];
  };

  assert.equal(manifest.game.id, "codex-critters");
  assert.equal(manifest.packageId, "codex-critters-library");
  assert.equal(manifest.publisher.id, "tcger-fixtures");
  assert.equal(
    gamePackageId(manifest),
    "tcger-fixtures--codex-critters-library",
  );
  assert.equal(gamePackageDefinition(manifest).id, manifest.game.id);
  assert.equal(gamePackageDefinition(manifest).interfaces?.search, true);
  assert.equal(gamePackageDefinition(manifest).interfaces?.scanner, false);
  assert.equal(
    gameDefinitionSupportsFeature(
      gamePackageDefinition(manifest),
      "tcger-fixtures--critter-index",
    ),
    true,
  );
  assert.equal(
    gamePackageDefinition(manifest).collection.defaultIdentityMode,
    "collector",
  );
  assert.equal(gamePackageDefinition(manifest).search.facets.length, 5);
  assert.equal(manifest.scanner, undefined);
  assert.equal(manifest.offlinePacks, undefined);
  assert.equal(catalogBytes.byteLength, manifest.catalog.asset.bytes);
  assert.equal(
    createHash("sha256").update(catalogBytes).digest("hex"),
    manifest.catalog.asset.sha256,
  );
  assert.equal(catalog.formatVersion, 1);
  assert.equal(catalog.tcg, manifest.game.id);
  assert.equal(catalog.cards.length, manifest.catalog.cardCount);
  assert.equal(catalog.sets.length, manifest.catalog.setCount);
  assert.equal(
    new Set(catalog.cards.map((card) => card.id)).size,
    catalog.cards.length,
  );
  const signingKey = {
    id: "release-1",
    algorithm: "ed25519" as const,
    publicKey: `${"A".repeat(43)}=`,
  };
  assert.equal(
    gamePackageManifestSchema.safeParse({
      ...manifest,
      publisher: { ...manifest.publisher, signingKey },
    }).success,
    false,
  );
  assert.equal(
    gamePackageManifestSchema.safeParse({
      ...manifest,
      publisher: { ...manifest.publisher, signingKey },
      signature: {
        algorithm: "ed25519",
        keyId: signingKey.id,
        url: "./codex-critters.game-package.json.sig",
      },
    }).success,
    true,
  );
  assert.equal(
    gamePackageManifestSchema.safeParse({
      ...manifest,
      definition: {
        ...manifest.definition,
        interfaces: {
          ...manifest.definition?.interfaces,
          features: [{ id: "critter-index", version: 1 }],
        },
      },
    }).success,
    false,
  );
  assert.deepEqual(
    new Set(manifest.filters.map((filter) => filter.type)),
    new Set(["select", "multiSelect", "numberRange", "boolean", "text"]),
  );

  const filtered = catalog.cards.filter((card) =>
    matchesGamePackageFilters(card, manifest.filters, {
      faction: ["sky"],
      rarity: "epic",
      cost: { min: 7, max: 7 },
      foilable: true,
      "card-name": "oracle",
    }),
  );
  assert.deepEqual(
    filtered.map((card) => card.name),
    ["Mooncrumb Oracle"],
  );
});

test("legacy v1 packages are adapted to the unified game definition", () => {
  const manifest = gamePackageManifestSchema.parse({
    schema: "https://tcger.app/schemas/game-package-manifest/v1",
    packageVersion: "1",
    publishedAt: "2026-08-27T00:00:00Z",
    game: { id: "legacy-demo", name: "Legacy Demo", shortName: "Legacy" },
    publisher: { name: "Publisher" },
    catalog: {
      schema: "tcger-catalog-v1",
      asset: { url: "catalog.json", bytes: 1, sha256: "0".repeat(64) },
      cardCount: 0,
    },
    filters: [{ id: "name", label: "Name", property: "name", type: "text" }],
  });

  assert.equal(gamePackageId(manifest), "legacy-demo");
  assert.equal(gamePackageDefinition(manifest).label, "Legacy Demo");
  assert.equal(gamePackageDefinition(manifest).search.facets[0]?.id, "name");
});

test("duplicate package versions and renamed copies of one catalog are gated", () => {
  const installed = gamePackageManifestSchema.parse({
    schema: "https://tcger.app/schemas/game-package-manifest/v1",
    packageId: "pokemon-library",
    packageVersion: "1",
    publishedAt: "2026-08-27T00:00:00Z",
    game: { id: "pokemon", name: "Pokémon" },
    publisher: { id: "publisher-a", name: "Publisher A" },
    catalog: {
      schema: "tcger-catalog-v1",
      asset: { url: "catalog.json", bytes: 1, sha256: "a".repeat(64) },
      cardCount: 0,
    },
  });
  assert.equal(
    duplicateGamePackage([installed], installed)?.kind,
    "same-package",
  );

  const included = gamePackageManifestSchema.parse({
    ...installed,
    packageId: "pokemon-catalog",
    publisher: { id: "tcger", name: "TCGer" },
  });
  assert.equal(duplicateGamePackage([], included)?.kind, "built-in");

  const renamed = gamePackageManifestSchema.parse({
    ...installed,
    packageId: "renamed-pokemon-library",
    publisher: { id: "publisher-b", name: "Publisher B" },
  });
  assert.equal(
    duplicateGamePackage([installed], renamed)?.kind,
    "same-catalog",
  );

  const update = gamePackageManifestSchema.parse({
    ...installed,
    packageVersion: "2",
    catalog: {
      ...installed.catalog,
      asset: { ...installed.catalog.asset, sha256: "b".repeat(64) },
    },
  });
  assert.equal(duplicateGamePackage([installed], update), undefined);
});

test("package updates are monotonic and reject rollback or release conflicts", () => {
  const current = gamePackageManifestSchema.parse({
    schema: "https://tcger.app/schemas/game-package-manifest/v1",
    packageId: "demo-library",
    packageVersion: "1.0.0",
    publishedAt: "2026-08-27T00:00:00Z",
    update: {
      sequence: 10,
      manifestUrl: "https://publisher.example/demo.game-package.json",
    },
    game: { id: "demo", name: "Demo" },
    publisher: { id: "publisher", name: "Publisher" },
    catalog: {
      schema: "tcger-catalog-v1",
      asset: { url: "catalog.json", bytes: 1, sha256: "a".repeat(64) },
      cardCount: 0,
    },
  });
  const next = gamePackageManifestSchema.parse({
    ...current,
    packageVersion: "2.0.0",
    publishedAt: "2026-08-28T00:00:00Z",
    update: { ...current.update, sequence: 11 },
    catalog: {
      ...current.catalog,
      asset: { ...current.catalog.asset, sha256: "b".repeat(64) },
    },
  });
  const conflict = gamePackageManifestSchema.parse({
    ...next,
    update: { ...next.update, sequence: 10 },
  });

  assert.equal(gamePackageReleaseRelation(current, next), "update");
  assert.equal(gamePackageReleaseRelation(next, current), "downgrade");
  assert.equal(gamePackageReleaseRelation(current, current), "same");
  assert.equal(gamePackageReleaseRelation(current, conflict), "conflict");
});

test("the app requests installation only when no game source is active", () => {
  const noneEnabled = { pokemon: false, magic: false };
  assert.equal(needsGameInstallation(noneEnabled, 0), true);
  assert.equal(needsGameInstallation(noneEnabled, 1), false);
  assert.equal(
    needsGameInstallation({ ...noneEnabled, pokemon: true }, 0),
    false,
  );
});

test("game-specific features resolve from built-in and installed packages", () => {
  const enabledGames = {
    yugioh: false,
    magic: false,
    pokemon: true,
    onepiece: false,
    lorcana: false,
    dragonball: false,
  };
  const officialPokemon = gamePackageManifestSchema.parse({
    schema: "https://tcger.app/schemas/game-package-manifest/v1",
    packageId: "pokemon-catalog",
    packageVersion: "1",
    publishedAt: "2026-08-30T00:00:00Z",
    game: { id: "pokemon", name: "Pokémon" },
    publisher: { id: "tcger", name: "TCGer" },
    catalog: {
      schema: "tcger-catalog-v1",
      asset: { url: "pokemon.pack.json", bytes: 1, sha256: "a".repeat(64) },
      cardCount: 0,
    },
    definition: GAME_DEFINITIONS.pokemon,
  });
  assert.deepEqual(
    activeGameFeatureSources(
      enabledGames,
      [officialPokemon],
      [],
      POKEDEX_GAME_FEATURE_ID,
    ).map((source) => source.id),
    ["tcger--pokemon-catalog"],
  );

  const fixtureDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../docs/scanner-system/examples/codex-critters",
  );
  const manifest = gamePackageManifestSchema.parse(
    JSON.parse(
      readFileSync(
        resolve(fixtureDirectory, "codex-critters.game-package.json"),
        "utf8",
      ),
    ),
  );
  const installed = {
    id: gamePackageId(manifest),
    sourceUrl: "https://example.com/manifest.json",
    installedAt: "2026-08-30T00:00:00.000Z",
    manifest,
  };
  assert.deepEqual(
    activeGameFeatureSources(
      { ...enabledGames, pokemon: false },
      [officialPokemon],
      [installed],
      "tcger-fixtures--critter-index",
    ).map((source) => source.id),
    [installed.id],
  );
});
