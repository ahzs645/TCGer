import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EMBEDDING_MATCH_THRESHOLDS,
  embeddingIndexesShareModel,
  matchEmbeddingShardsTopK,
  type EmbeddingIndex,
} from "./embedding-matcher";
import type { SupportedTcg } from "./scan-types";

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
