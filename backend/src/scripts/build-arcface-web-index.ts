/**
 * Build the web ArcFace index artifact from the iOS ArcFace index bin.
 *
 * The trainer emits CardsIndexVectors-arcface.bin and CardsIndexMetadata.json
 * in the same annIndex order. The web artifact is that metadata plus the bin's
 * vectors, verbatim, so iOS, Android, and web share one catalog ordering.
 *
 * The version-2 artifact carries its own operating point (`thresholds`) and
 * the encoder model URL (`modelUrl`) so model, index, and thresholds travel
 * as one calibrated unit — the web equivalent of iOS's ScannerEncoderVariant.
 *
 * Usage:
 *   tsx src/scripts/build-arcface-web-index.ts \
 *     --bin ../tmp/arcface-web/CardsIndexVectors-arcface.bin \
 *     --metadata <path-to>/CardsIndexMetadata.json \
 *     --tcg pokemon \
 *     --model-url pokemon-card-embeddings-arcface.onnx \
 *     [--out ../frontend/public/scan-index/pokemon-embeddings-arcface.json]
 *
 * Then: tsx src/scripts/update-scan-index-manifest.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// PROVISIONAL operating point: iOS strong-accept 0.65 / ambiguity 0.05 (same
// model + same index vectors, so the same score scale), pending a web-pipeline
// sweep of its own. The 0.65 floor is above the measured 0.6476 bundled
// negative ceiling after physical-card-only index filtering. The web accept
// logic (top-20 shortlist + OCR tiebreaker + track averaging) still differs
// from the iOS acceptance ladder. minVerifiedSimilarity shifts DINOv2's 0.65
// verified floor down by the same 0.07 strong-threshold scale offset; it is
// inert until allowVerifiedMarginAcceptance is enabled anywhere.
const ARCFACE_THRESHOLDS = {
  minSimilarity: 0.65,
  minVerifiedSimilarity: 0.58,
  minMargin: 0.05,
};

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

function main() {
  const binPath = resolve(
    arg("bin", resolve(__dirname, "../../../tmp/arcface-web/CardsIndexVectors-arcface.bin")),
  );
  const tcg = arg("tcg", "pokemon").toLowerCase();
  if (!/^[a-z0-9-]+$/.test(tcg)) throw new Error("--tcg must be a lowercase game key");
  const metadataArgument = arg("metadata", "");
  const baseArgument = arg("base", "");
  if (!metadataArgument && !baseArgument) {
    throw new Error("provide --metadata (preferred) or the legacy --base artifact");
  }
  const outPath = resolve(
    arg("out", resolve(__dirname, `../../../frontend/public/scan-index/${tcg}-embeddings-arcface.json`)),
  );
  const sourceRows = metadataArgument
    ? JSON.parse(readFileSync(resolve(metadataArgument), "utf8"))
    : JSON.parse(readFileSync(resolve(baseArgument), "utf8")).entries;
  if (!Array.isArray(sourceRows)) throw new Error("metadata/base entries must be an array");
  const entries = sourceRows.map((row: Record<string, unknown>, annIndex: number) => {
    if (metadataArgument && row.annIndex !== annIndex) {
      throw new Error(`metadata annIndex mismatch at row ${annIndex}`);
    }
    const rowGame = String(row.game ?? tcg).toLowerCase();
    if (rowGame !== tcg) throw new Error(`metadata row ${annIndex} is ${rowGame}, not ${tcg}`);
    return {
      externalId: String(row.cardId ?? row.externalId ?? ""),
      name: String(row.name ?? ""),
      setCode: row.setCode ?? null,
      setName: row.setName ?? null,
      rarity: row.rarity ?? null,
      imageUrl: row.imageURL ?? row.imageUrl ?? null,
      recognitionFamilyId: row.recognitionFamilyId ?? null,
      exactPrintingId: row.exactPrintingId ?? row.cardId ?? row.externalId ?? null,
      releaseDate: row.releaseDate ?? row.releasedAt ?? null,
    };
  });
  const bin = readFileSync(binPath);
  const count = bin.readInt32LE(0);
  const dimension = bin.readInt32LE(4);
  if (count !== entries.length) {
    throw new Error(
      `bin rows (${count}) != metadata entries (${entries.length}) — annIndex order broken?`,
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
    version: Number.parseInt(arg("version", "1"), 10),
    kind: "embedding-index",
    model: arg("model", `tcger/arcface-fastvit-t8-${tcg}-full`),
    dtype: arg("dtype", "fp32"),
    encoder: "arcface",
    dimension,
    tcg,
    quantization: "int8",
    scale: 127,
    normalized: true,
    total: count,
    thresholds: ARCFACE_THRESHOLDS,
    modelUrl: arg("model-url", `${tcg}-card-embeddings-arcface.onnx`),
    entries,
    vectors: Buffer.from(vectors).toString("base64"),
  };
  writeFileSync(outPath, JSON.stringify(artifact));
  console.log(
    `[arcface-index] ${count} x ${dimension} (${zeroRows} zero rows) → ${outPath} ` +
      `(${(Buffer.byteLength(JSON.stringify(artifact)) / 1e6).toFixed(1)} MB)`,
  );
}

main();
