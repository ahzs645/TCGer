import assert from "node:assert/strict";
import test from "node:test";

import {
  embeddingEntryMatchesExternalIds,
  DEFAULT_EMBEDDING_MATCH_THRESHOLDS,
  embeddingIndexesShareModel,
  matchEmbeddingTopK,
  matchEmbeddingShardsTopK,
  restrictEmbeddingIndexToExternalIds,
  resolveEmbeddingPrintingCandidates,
  type EmbeddingIndex,
} from "./embedding-matcher";
import { fuseMagicTitleWithShortlist } from "./collector-ocr";
import type { SupportedTcg } from "./scan-types";
import type { BrowserVideoScanCandidate } from "./scan-types";

function shard(
  tcg: SupportedTcg,
  externalId: string,
  vector: readonly number[],
  modelUrl = "/scan-index/shared-encoder.onnx",
): EmbeddingIndex {
  const vectors = Int8Array.from(vector);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return {
    model: "tcger/universal-arcface",
    dtype: "int8",
    encoder: "arcface",
    dimension: vector.length,
    tcg,
    scale: 127,
    total: 1,
    entries: [
      {
        externalId,
        name: externalId,
        setCode: null,
        setName: null,
        rarity: null,
        imageUrl: null,
        recognitionFamilyId: null,
        exactPrintingId: externalId,
        releaseDate: null,
      },
    ],
    vectors,
    invNorms: new Float32Array([norm > 0 ? 1 / norm : 0]),
    thresholds: DEFAULT_EMBEDDING_MATCH_THRESHOLDS,
    modelUrl,
    gateUrl: null,
  };
}

test("automatic mode ranks compatible game shards globally", () => {
  const pokemon = shard("pokemon", "pokemon-best", [127, 0]);
  const magic = shard("magic", "magic-second", [100, 80]);

  const candidates = matchEmbeddingShardsTopK(
    new Float32Array([1, 0]),
    [magic, pokemon],
    { topK: 2, tcgFilter: "all" },
  );

  assert.deepEqual(
    candidates.map(({ externalId, tcg }) => ({ externalId, tcg })),
    [
      { externalId: "pokemon-best", tcg: "pokemon" },
      { externalId: "magic-second", tcg: "magic" },
    ],
  );
});

test("quick scan promotes the newest printing in an artwork family", () => {
  const resolved = resolveEmbeddingPrintingCandidates(
    [printing("old", "2020-01-01"), printing("new", "2024-02-02")],
    "quick_latest",
  );

  assert.equal(resolved[0]?.externalId, "new");
  assert.equal(resolved[0]?.printingResolutionProvenance, "latest_fallback");
});

test("exact mode marks an artwork family as requiring user choice", () => {
  const resolved = resolveEmbeddingPrintingCandidates(
    [printing("old", "2020-01-01"), printing("new", "2024-02-02")],
    "exact_printing",
  );

  assert.equal(resolved[0]?.requiresPrintingChoice, true);
  assert.equal(resolved[1]?.requiresPrintingChoice, true);
});

test("one visual-family vector expands its exact printings after retrieval", () => {
  const family = printing("new", "2025-01-01");
  family.printings = [
    {
      externalId: "new",
      exactPrintingId: "new",
      setCode: "new",
      setName: "New Set",
      rarity: null,
      imageUrl: null,
      releaseDate: "2025-01-01",
    },
    {
      externalId: "old",
      exactPrintingId: "old",
      setCode: "old",
      setName: "Old Set",
      rarity: null,
      imageUrl: null,
      releaseDate: "2020-01-01",
    },
  ];

  const quick = resolveEmbeddingPrintingCandidates([family], "quick_latest");
  assert.equal(quick[0]?.externalId, "new");
  assert.equal(quick[0]?.printingResolutionProvenance, "latest_fallback");

  const exact = resolveEmbeddingPrintingCandidates([family], "exact_printing");
  assert.deepEqual(exact.slice(0, 2).map((row) => row.externalId), ["new", "old"]);
  assert.equal(exact[0]?.requiresPrintingChoice, true);
});

function printing(id: string, releaseDate: string): BrowserVideoScanCandidate {
  return {
    externalId: id,
    tcg: "pokemon",
    name: "Pikachu",
    setCode: id,
    setName: id,
    rarity: null,
    imageUrl: null,
    confidence: id === "old" ? 0.95 : 0.93,
    distance: 50,
    scoreDistance: 50,
    passedThreshold: true,
    fullDistance: 50,
    titleDistance: null,
    footerDistance: null,
    proposalLabel: "test",
    recognitionFamilyId: "art:pikachu-1",
    exactPrintingId: id,
    releaseDate,
  };
}

test("a game-specific mode searches only its selected shard", () => {
  const magic = shard("magic", "magic-only", [127, 0]);
  const candidates = matchEmbeddingShardsTopK(
    new Float32Array([1, 0]),
    [magic],
    { tcgFilter: "magic" },
  );

  assert.equal(candidates[0]?.tcg, "magic");
  assert.equal(candidates[0]?.externalId, "magic-only");
});

test("automatic mode rejects shards from different encoder contracts", () => {
  const pokemon = shard("pokemon", "pokemon", [127, 0]);
  const yugioh = shard(
    "yugioh",
    "yugioh",
    [127, 0],
    "/scan-index/other-encoder.onnx",
  );

  assert.equal(embeddingIndexesShareModel([pokemon, yugioh]), false);
  assert.deepEqual(
    matchEmbeddingShardsTopK(new Float32Array([1, 0]), [pokemon, yugioh]),
    [],
  );
});

test("deck-scoped matching searches only selected Yu-Gi-Oh passcodes", () => {
  const index = shard("yugioh", "89631139", [127, 0]);
  index.total = 2;
  index.entries = [
    index.entries[0]!,
    {
      ...index.entries[0]!,
      externalId: "46986414",
      name: "Dark Magician",
    },
  ];
  index.vectors = Int8Array.from([127, 0, 120, 20]);
  index.invNorms = Float32Array.from([
    1 / 127,
    1 / Math.sqrt(120 * 120 + 20 * 20),
  ]);

  const matches = matchEmbeddingTopK(new Float32Array([1, 0]), index, {
    topK: 5,
    minSimilarity: 0.65,
    allowedExternalIds: new Set(["46986414"]),
  });

  assert.deepEqual(
    matches.map((candidate) => candidate.externalId),
    ["46986414"],
  );
  assert.equal(matches[0]?.passedThreshold, true);
  assert.deepEqual(
    matchEmbeddingTopK(new Float32Array([1, 0]), index, {
      allowedExternalIds: new Set(["not-in-index"]),
    }),
    [],
  );

  const restricted = restrictEmbeddingIndexToExternalIds(
    index,
    new Set(["46986414"]),
  );
  assert.equal(restricted.total, 1);
  assert.equal(restricted.entries[0]?.externalId, "46986414");
  assert.deepEqual([...restricted.vectors], [120, 20]);
  assert.equal(index.total, 2, "cached source index remains unchanged");
});

test("deck scope recognizes nested exact-printing ids", () => {
  const entry = {
    externalId: "representative",
    name: "Alternate artwork",
    setCode: null,
    setName: null,
    rarity: null,
    imageUrl: null,
    exactPrintingId: "representative-print",
    printings: [
      {
        externalId: "46986414",
        exactPrintingId: "printing-46986414",
        setCode: null,
        setName: null,
        rarity: null,
        imageUrl: null,
        releaseDate: null,
      },
    ],
  };
  assert.equal(
    embeddingEntryMatchesExternalIds(entry, new Set(["printing-46986414"])),
    true,
  );
  assert.equal(
    embeddingEntryMatchesExternalIds(entry, new Set(["89631139"])),
    false,
  );
});

test("Magic title OCR rescues only unique, visually supported identities", () => {
  const candidate = {
    ...printing("magic-map", "2026-08-14"),
    tcg: "magic" as const,
    name: "Thrór's Map",
    confidence: 0.8,
    passedThreshold: false,
  };
  const catalog = [{
    externalId: "magic-map",
    name: "Thrór's Map",
    setCode: "fin",
    setName: "Final Fantasy",
    rarity: null,
    imageUrl: null,
    exactPrintingId: "magic-map",
    printings: [{
      externalId: "magic-map",
      exactPrintingId: "magic-map",
      setCode: "fin",
      setName: "Final Fantasy",
      rarity: null,
      imageUrl: null,
      releaseDate: "2026-08-14",
    }],
  }];

  const corrected = fuseMagicTitleWithShortlist(
    [candidate],
    catalog,
    "Thrór's Man",
  );
  assert.equal(corrected.matched, true);
  assert.equal(corrected.candidates[0]?.passedThreshold, true);
  assert.equal(corrected.candidates[0]?.proposalLabel, "embedding+title-ocr");

  assert.equal(fuseMagicTitleWithShortlist(
    [{ ...candidate, confidence: 0.74 }],
    catalog,
    "Thrór's Man",
  ).matched, false);
  assert.equal(fuseMagicTitleWithShortlist(
    [{ ...candidate, name: "Óin the Brave", confidence: 0.56 }],
    [{ ...catalog[0]!, name: "Óin the Brave" }],
    "Oin the Brave",
  ).matched, true);
  assert.equal(fuseMagicTitleWithShortlist(
    [candidate],
    [{ ...catalog[0]!, printings: [...catalog[0]!.printings, {
      ...catalog[0]!.printings[0]!,
      externalId: "magic-map-reprint",
      exactPrintingId: "magic-map-reprint",
    }] }],
    "Thrór's Map",
  ).matched, false);
});
