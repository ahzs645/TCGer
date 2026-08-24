/**
 * Build the web ArcFace index artifact from the iOS ArcFace index bin.
 *
 * The trainer (mobile-apps/ios/scripts/train_arcface_encoder.py) emits
 * CardsIndexVectors-arcface.bin in annIndex order — the SAME order as the
 * existing web artifact's entries (build-ios-index.ts derives the iOS
 * metadata from the web artifact). So the web ArcFace index is the existing
 * artifact's entry metadata + the bin's vectors, verbatim: exact vector
 * parity with the iOS index by construction (validated end-to-end by
 * export_arcface_onnx.py's live-image self-retrieval check).
 *
 * The version-2 artifact carries its own operating point (`thresholds`) and
 * the encoder model URL (`modelUrl`) so model, index, and thresholds travel
 * as one calibrated unit — the web equivalent of iOS's ScannerEncoderVariant.
 *
 * Usage:
 *   tsx src/scripts/build-arcface-web-index.ts \
 *     --bin ../tmp/arcface-web/CardsIndexVectors-arcface.bin \
 *     [--base ../frontend/public/scan-index/pokemon-embeddings.json] \
 *     [--out ../frontend/public/scan-index/pokemon-embeddings-arcface.json]
 *
 * Then: tsx src/scripts/update-scan-index-manifest.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// PROVISIONAL operating point: the iOS-swept strong-accept 0.60 / ambiguity
// 0.05 (same model + same index vectors, so the same score scale), pending a
// web-pipeline sweep of its own — the web accept logic (top-20 shortlist +
// OCR tiebreaker + track averaging) differs from the iOS acceptance ladder.
// minVerifiedSimilarity shifts the DINOv2 0.65 by the same scale offset; it
// is inert until allowVerifiedMarginAcceptance is enabled anywhere.
const ARCFACE_THRESHOLDS = {
  minSimilarity: 0.6,
  minVerifiedSimilarity: 0.53,
  minMargin: 0.05,
};

const ARCFACE_MODEL_ID = "tcger/arcface-fastvit-t8-e5";
const ARCFACE_MODEL_URL = "/scan-index/card-embeddings-arcface.onnx";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

function main() {
  const binPath = resolve(
    arg("bin", resolve(__dirname, "../../../tmp/arcface-web/CardsIndexVectors-arcface.bin")),
  );
  const basePath = resolve(
    arg("base", resolve(__dirname, "../../../frontend/public/scan-index/pokemon-embeddings.json")),
  );
  const outPath = resolve(
    arg("out", resolve(__dirname, "../../../frontend/public/scan-index/pokemon-embeddings-arcface.json")),
  );

  const base = JSON.parse(readFileSync(basePath, "utf8"));
  const bin = readFileSync(binPath);
  const count = bin.readInt32LE(0);
  const dimension = bin.readInt32LE(4);
  if (count !== base.entries.length) {
    throw new Error(
      `bin rows (${count}) != base artifact entries (${base.entries.length}) — annIndex order broken?`,
    );
  }
  const expectedBytes = 8 + count * dimension;
  if (bin.length !== expectedBytes) {
    throw new Error(`bin size ${bin.length} != expected ${expectedBytes}`);
  }

  const vectors = bin.subarray(8);
  let zeroRows = 0;
  for (let i = 0; i < count; i++) {
    let any = false;
    for (let k = 0; k < dimension && !any; k++)
      any = vectors[i * dimension + k] !== 0;
    if (!any) zeroRows++;
  }

  const artifact = {
    version: 2,
    kind: "embedding-index",
    model: ARCFACE_MODEL_ID,
    dtype: "fp16",
    encoder: "arcface",
    dimension,
    tcg: base.tcg ?? "pokemon",
    quantization: "int8",
    scale: 127,
    normalized: true,
    total: count,
    thresholds: ARCFACE_THRESHOLDS,
    modelUrl: ARCFACE_MODEL_URL,
    entries: base.entries,
    vectors: Buffer.from(vectors).toString("base64"),
  };
  writeFileSync(outPath, JSON.stringify(artifact));
  console.log(
    `[arcface-index] ${count} x ${dimension} (${zeroRows} zero rows) → ${outPath} ` +
      `(${(Buffer.byteLength(JSON.stringify(artifact)) / 1e6).toFixed(1)} MB)`,
  );
}

main();
