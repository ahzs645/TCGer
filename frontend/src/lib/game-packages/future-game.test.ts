import assert from "node:assert/strict";
import test from "node:test";
import {
  cardSchema,
  createDeckSchema,
  createWishlistSchema,
  gameDeckRulesSchema,
  gamePackageManifestSchema,
  getGameDefinitionOrDefault,
  gameCardLegality,
  gamePriceSnapshotSchema,
  gameSnapshotQuote,
  gamePackLibrarySchema,
  openGamePack,
  validateGameDeck,
  matchesCollectionFacets,
  gameDefinitionSchema,
} from "@tcg/api-types";

const rules = gameDeckRulesSchema.parse({
  version: 1,
  defaultFormat: "duel",
  formats: [
    {
      id: "duel",
      label: "Duel",
      defaultZone: "lineup",
      maxCopies: 2,
      zones: [
        {
          id: "captain",
          label: "Captain",
          min: 1,
          max: 1,
          eligibility: [{ property: "attributes.role", values: ["captain"] }],
        },
        { id: "lineup", label: "Lineup", min: 2, max: 4 },
      ],
    },
  ],
});
const card = (
  id: string,
  zone = "lineup",
  quantity = 1,
  baseExternalId = id,
) => ({
  externalId: id,
  tcg: "star-garden",
  name: id,
  zone,
  quantity,
  cardData: {
    baseExternalId,
    attributes: { role: id === "leader" ? "captain" : "unit" },
  },
});

test("new game identifiers survive normal card and deck contracts", () => {
  assert.equal(
    cardSchema.parse({
      id: "a",
      name: "A",
      tcg: "star-garden",
      formatLegality: { duel: true, draft: false },
    }).formatLegality?.duel,
    true,
  );
  assert.equal(
    createDeckSchema.parse({ name: "Test", tcg: "star-garden", rules }).rules
      ?.formats[0]?.defaultZone,
    "lineup",
  );
  for (const id of ["bad/game", "", "../pokemon", "UPPERCASE"])
    assert.equal(
      cardSchema.safeParse({ id: "a", name: "A", tcg: id }).success,
      false,
    );
  assert.equal(getGameDefinitionOrDefault("constructor").id, "constructor");
});
test("declarative deck zones and copy limits span printings and zones", () => {
  assert.equal(
    validateGameDeck(
      "star-garden",
      [card("leader", "captain"), card("a", "lineup", 2)],
      rules,
    ).valid,
    true,
  );
  const invalid = validateGameDeck(
    "star-garden",
    [card("a", "captain"), card("a-art", "lineup", 2, "a")],
    rules,
  );
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((e) => e.includes("not eligible")));
  assert.ok(invalid.errors.some((e) => e.includes("2-copy")));
  assert.equal(
    validateGameDeck("star-garden", [card("a", "undefined-zone")], rules).valid,
    false,
  );
  assert.equal(
    validateGameDeck("star-garden", [], rules, "unsupported-format").status,
    "unsupported",
  );
});
test("unknown legality cannot masquerade as a validated deck", () => {
  const legalRules = structuredClone(rules);
  legalRules.formats[0]!.requireLegality = true;
  const result = validateGameDeck(
    "star-garden",
    [card("leader", "captain"), card("a", "lineup", 2)],
    legalRules,
  );
  assert.equal(result.status, "unknown");
  assert.equal(result.valid, false);
});
test("arbitrary formats support dated legality and generic facets", () => {
  const c = {
    sanctionedPlayLegal: true,
    formatLegality: { duel: true },
    legalityPeriods: [
      {
        format: "duel",
        legal: false,
        validFrom: "2026-01-01",
        validTo: "2026-02-01",
      },
    ],
  };
  assert.equal(gameCardLegality(c, "duel", "2026-01-01"), false);
  assert.equal(gameCardLegality(c, "duel", "2026-02-01"), undefined);
  const definition = gameDefinitionSchema.parse({
    ...getGameDefinitionOrDefault("star-garden"),
    search: {
      facets: [
        {
          id: "duel",
          label: "Duel",
          type: "boolean",
          property: "formatLegality.duel",
        },
      ],
    },
  });
  assert.equal(
    matchesCollectionFacets(
      { name: "A", quantity: 1, formatLegality: { duel: true } } as any,
      definition.search.facets,
      { duel: true },
    ),
    true,
  );
});
test("quotes match exact variants and expire without inventing a price", () => {
  const snapshot = gamePriceSnapshotSchema.parse({
    schema: "tcger-price-snapshot-v1",
    gameId: "star-garden",
    quotes: [
      {
        cardId: "a",
        finishCode: "matte",
        amount: 2,
        currency: "CAD",
        source: "Publisher",
        observedAt: "2026-01-01T00:00:00Z",
        expiresAt: "2026-02-01T00:00:00Z",
      },
    ],
  });
  const now = Date.parse("2026-01-10T00:00:00Z");
  assert.equal(
    gameSnapshotQuote(
      snapshot,
      { cardId: "a", finishCode: "matte", currency: "CAD" },
      now,
    )?.amount,
    2,
  );
  assert.equal(
    gameSnapshotQuote(snapshot, { cardId: "a", currency: "CAD" }, now),
    undefined,
  );
  assert.equal(
    gameSnapshotQuote(
      snapshot,
      { cardId: "a", finishCode: "matte", currency: "USD" },
      now,
    ),
    undefined,
  );
  assert.equal(
    gameSnapshotQuote(
      snapshot,
      { cardId: "a", finishCode: "matte", currency: "CAD" },
      Date.parse("2026-02-01"),
    ),
    undefined,
  );
});
test("pack collation honors weighted slots and without-replacement draws", () => {
  const input = {
    schema: "tcger-pack-library-v1",
    gameId: "star-garden",
    packs: [
      {
        id: "launch",
        name: "Launch",
        setCode: "SG1",
        slots: [
          {
            count: 2,
            withoutReplacement: true,
            pool: [
              { cardId: "a", weight: 9 },
              { cardId: "b", weight: 1 },
            ],
          },
        ],
      },
    ],
  };
  const pack = gamePackLibrarySchema.parse(input).packs[0]!;
  assert.deepEqual(
    openGamePack(pack, () => 0),
    ["a", "b"],
  );
  assert.deepEqual(
    openGamePack(pack, () => 0.99),
    ["b", "a"],
  );
  input.packs[0]!.slots[0]!.count = 3;
  assert.equal(gamePackLibrarySchema.safeParse(input).success, false);
});
test("v2 flags require real contracts while old catalog packages remain readable", () => {
  const manifest = {
    schema: "https://tcger.app/schemas/game-package-manifest/v2",
    packageVersion: "1",
    publishedAt: "2026-01-01T00:00:00Z",
    game: { id: "star-garden", name: "Star Garden" },
    publisher: { name: "Test" },
    catalog: {
      schema: "tcger-catalog-v1",
      asset: { url: "cards.json", bytes: 1, sha256: "a".repeat(64) },
      cardCount: 0,
    },
    definition: {
      ...getGameDefinitionOrDefault("star-garden"),
      interfaces: {
        ...getGameDefinitionOrDefault("star-garden").interfaces,
        decks: true,
      },
    },
  };
  assert.equal(gamePackageManifestSchema.safeParse(manifest).success, false);
  assert.equal(
    gamePackageManifestSchema.safeParse({
      ...manifest,
      definition: { ...manifest.definition, deckRules: rules },
    }).success,
    true,
  );
});

test("published future-game fixture verifies, opens, validates and prices its exact copies", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const { resolve } = await import("node:path");
  const root = resolve(
    __dirname,
    "../../../../docs/scanner-system/examples/star-garden",
  );
  const manifest = gamePackageManifestSchema.parse(
    JSON.parse(await readFile(resolve(root, "game-package.json"), "utf8")),
  );
  for (const asset of [
    manifest.catalog.asset,
    manifest.pricing!.asset,
    manifest.offlinePacks!.manifest,
  ]) {
    const bytes = await readFile(resolve(root, asset.url));
    assert.equal(bytes.length, asset.bytes);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      asset.sha256,
    );
  }
  const catalog = JSON.parse(
    await readFile(resolve(root, "cards.json"), "utf8"),
  );
  const library = gamePackLibrarySchema.parse(
    JSON.parse(await readFile(resolve(root, "packs.json"), "utf8")),
  );
  const snapshot = gamePriceSnapshotSchema.parse(
    JSON.parse(await readFile(resolve(root, "prices.json"), "utf8")),
  );
  const pulls = openGamePack(library.packs[0]!, () => 0);
  assert.deepEqual(pulls, ["captain-1", "scout-1", "scout-2"]);
  const deck = pulls.map((id) => {
    const data = catalog.cards.find((c: any) => c.id === id);
    return {
      externalId: id,
      tcg: manifest.game.id,
      name: data.name,
      quantity: 1,
      zone: data.attributes.role === "captain" ? "captain" : "lineup",
      cardData: data,
    };
  });
  assert.equal(
    validateGameDeck(
      manifest.game.id,
      deck,
      manifest.definition!.deckRules!,
      undefined,
      "2026-09-05",
    ).valid,
    true,
  );
  assert.equal(
    gameSnapshotQuote(
      snapshot,
      {
        cardId: "scout-1",
        printingKey: "scout-1",
        currency: "USD",
        finishCode: "matte",
        condition: "NM",
        language: "English",
      },
      Date.parse("2026-09-05"),
    )?.amount,
    2,
  );
  assert.equal(manifest.definition!.printings!.finishes[0]!.foil, false);
});
