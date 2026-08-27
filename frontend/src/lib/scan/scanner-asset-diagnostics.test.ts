import assert from "node:assert/strict";
import test from "node:test";

import {
  runScannerAssetDiagnostics,
  validateEmbeddingArtifact,
} from "./scanner-asset-diagnostics";

test("validates embedding entry and packed-vector cardinality", () => {
  const artifact = {
    kind: "embedding-index",
    model: "tcger/example",
    encoder: "arcface",
    dimension: 2,
    tcg: "pokemon",
    total: 2,
    entries: [{}, {}],
    vectors: Buffer.from(new Int8Array([1, 2, 3, 4]).buffer).toString("base64"),
  };
  assert.deepEqual(
    validateEmbeddingArtifact(artifact, {
      tcg: "pokemon",
      dimension: 2,
      total: 2,
    }),
    [],
  );
});

test("reports mismatched embedding metadata and vector bytes", () => {
  const errors = validateEmbeddingArtifact(
    {
      kind: "wrong",
      model: "",
      encoder: "",
      dimension: 3,
      tcg: "magic",
      total: 2,
      entries: [{}],
      vectors: "AA==",
    },
    { tcg: "pokemon", dimension: 2, total: 2 },
  );
  assert.ok(errors.some((error) => error.includes("kind")));
  assert.ok(errors.some((error) => error.includes("vector bytes")));
  assert.ok(errors.some((error) => error.includes("entries length")));
});

test("rejects malformed base64 even when its encoded length looks plausible", () => {
  const errors = validateEmbeddingArtifact(
    {
      kind: "embedding-index",
      model: "tcger/example",
      encoder: "arcface",
      dimension: 3,
      tcg: "pokemon",
      total: 1,
      entries: [{}],
      vectors: "!!!!",
    },
    { tcg: "pokemon", dimension: 3, total: 1 },
  );
  assert.ok(errors.some((error) => error.includes("valid base64")));
});

test("reports an invalid manifest asset path without aborting the diagnostic run", async () => {
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/manifest.json")) {
      return new Response(
        JSON.stringify({
          indexes: {
            pokemon: {
              file: "../escape.json",
              dimension: 2,
              total: 1,
            },
          },
        }),
        { status: 200 },
      );
    }
    return new Response("missing", { status: 404 });
  }) as typeof fetch;

  const checks = await runScannerAssetDiagnostics(fetcher);
  assert.equal(
    checks.find((check) => check.id === "index-pokemon")?.status,
    "fail",
  );
  assert.ok(checks.some((check) => check.id === "detector"));
});
