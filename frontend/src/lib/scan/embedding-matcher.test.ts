import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EMBEDDING_MATCH_THRESHOLDS,
  embeddingIndexesShareModel,
  matchEmbeddingShardsTopK,
  resolveEmbeddingPrintingCandidates,
  type EmbeddingIndex,
} from "./embedding-matcher";
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
