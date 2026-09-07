/** Deterministic fictional package for cross-platform conformance tests. */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getGameDefinitionOrDefault,
  gamePackageManifestSchema,
  gameDeckRulesSchema,
  gamePackLibrarySchema,
  gamePriceSnapshotSchema,
} from "../../packages/api-types/src/index";
const directory = resolve(
  __dirname,
  "../../docs/scanner-system/examples/star-garden",
);
mkdirSync(directory, { recursive: true });
function asset(name: string, value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  writeFileSync(resolve(directory, name), bytes);
  return {
    url: name,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
const rules = gameDeckRulesSchema.parse({
  version: 1,
  defaultFormat: "duel",
  formats: [
    {
      id: "duel",
      label: "Garden Duel",
      defaultZone: "lineup",
      maxCopies: 2,
      requireLegality: true,
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
const cards = [
  {
    id: "captain-1",
    baseExternalId: "captain",
    printingKey: "captain-1",
    name: "Orchid Captain",
    rarity: "bloom",
    attributes: { role: "captain" },
  },
  {
    id: "scout-1",
    baseExternalId: "scout",
    printingKey: "scout-1",
    name: "Moonseed Scout",
    rarity: "seed",
    attributes: { role: "unit" },
  },
  {
    id: "scout-2",
    baseExternalId: "scout",
    printingKey: "scout-2",
    name: "Moonseed Scout",
    rarity: "bloom",
    attributes: { role: "unit" },
  },
].map((card, index) => ({
  ...card,
  setCode: "SG1",
  setName: "First Garden",
  collectorNumber: String(index + 1),
  sanctionedPlayLegal: true,
  formatLegality: { duel: true },
  legalityPeriods: [{ format: "duel", legal: true, validFrom: "2026-09-01" }],
}));
const catalog = asset("cards.json", {
  formatVersion: 1,
  tcg: "star-garden",
  cards,
  sets: [{ code: "SG1", name: "First Garden", cardCount: 3 }],
});
const packs = asset(
  "packs.json",
  gamePackLibrarySchema.parse({
    schema: "tcger-pack-library-v1",
    gameId: "star-garden",
    packs: [
      {
        id: "first-garden",
        name: "First Garden",
        setCode: "SG1",
        slots: [
          { count: 1, pool: [{ cardId: "captain-1", weight: 1 }] },
          {
            count: 2,
            withoutReplacement: true,
            pool: [
              { cardId: "scout-1", weight: 4 },
              { cardId: "scout-2", weight: 1 },
            ],
          },
        ],
      },
    ],
  }),
);
const pricing = asset(
  "prices.json",
  gamePriceSnapshotSchema.parse({
    schema: "tcger-price-snapshot-v1",
    gameId: "star-garden",
    quotes: cards.map((card) => ({
      cardId: card.id,
      printingKey: card.printingKey,
      finishCode: "matte",
      condition: "NM",
      language: "English",
      amount: 2,
      currency: "USD",
      source: "Fictional test prices",
      observedAt: "2026-09-01T00:00:00Z",
      expiresAt: "2026-10-01T00:00:00Z",
    })),
  }),
);
const base = getGameDefinitionOrDefault("star-garden");
asset(
  "game-package.json",
  gamePackageManifestSchema.parse({
    schema: "https://tcger.app/schemas/game-package-manifest/v2",
    packageId: "star-garden",
    packageVersion: "1",
    publishedAt: "2026-09-01T00:00:00Z",
    game: { id: "star-garden", name: "Star Garden" },
    publisher: { id: "tcger-fixtures", name: "TCGer fixtures" },
    catalog: {
      schema: "tcger-catalog-v1",
      asset: catalog,
      cardCount: cards.length,
      setCount: 1,
    },
    pricing: { schema: "tcger-price-snapshot-v1", asset: pricing },
    offlinePacks: { schema: "tcger-pack-library-v1", manifest: packs },
    definition: {
      ...base,
      label: "Star Garden",
      interfaces: {
        ...base.interfaces,
        decks: true,
        pricing: true,
        packOpening: true,
      },
      deckRules: rules,
      printings: {
        version: 1,
        selection: "printing",
        finishes: [
          { code: "matte", label: "Matte petal", foil: false },
          { code: "moon-glow", label: "Moon glow", foil: true },
        ],
      },
      search: {
        facets: [
          {
            id: "duel",
            label: "Duel legal",
            property: "formatLegality.duel",
            type: "boolean",
          },
        ],
      },
    },
  }),
);
