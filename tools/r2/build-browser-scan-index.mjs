import { basename, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  assertPhysicalScannerEntries,
  parseCliArgs,
  positiveInteger,
} from "./lib.mjs";

function usage() {
  console.log(`Usage:
  npm run scanner:build-browser-index -- \\
    --game pokemon --version 4 \\
    --metadata /path/CardsIndexMetadata.json \\
    --vectors /path/CardsIndexVectors-arcface.bin \\
    --model-file pokemon-card-embeddings-arcface.onnx \\
    --output frontend/public/scan-index/pokemon-embeddings-arcface.json

Converts the native row-aligned int8 scanner release into the browser index
contract without downloading card images or changing vector order.`);
}

function required(values, name) {
  const value = values.get(name)?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function finiteNumber(values, name, fallback) {
  const raw = values.get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
  return value;
}

function printingRecord(printing) {
  return {
    externalId: printing.exactPrintingId ?? printing.cardId,
    exactPrintingId: printing.exactPrintingId ?? printing.cardId,
    setCode: printing.setCode ?? null,
    setName: printing.setName ?? null,
    collectorNumber: printing.collectorNumber ?? null,
    rarity: printing.rarity ?? null,
    imageUrl: printing.imageURL ?? printing.imageUrl ?? null,
    releaseDate: printing.releaseDate ?? null,
  };
}

function browserEntry(entry) {
  const printings = Array.isArray(entry.printings) && entry.printings.length > 0
    ? entry.printings.map(printingRecord)
    : [printingRecord(entry)];
  return {
    externalId: entry.exactPrintingId ?? entry.cardId,
    name: entry.name,
    setCode: entry.setCode ?? null,
    setName: entry.setName ?? null,
    collectorNumber: entry.collectorNumber ?? null,
    rarity: entry.rarity ?? null,
    imageUrl: entry.imageURL ?? entry.imageUrl ?? null,
    recognitionFamilyId: entry.recognitionFamilyId
      ?? `${entry.game ?? "unknown"}:printing:${entry.cardId}`,
    exactPrintingId: entry.exactPrintingId ?? entry.cardId,
    releaseDate: entry.releaseDate ?? null,
    printings,
  };
}

export function buildBrowserIndex({
  metadata,
  vectorContents,
  game,
  version,
  modelFile,
  model,
  minSimilarity = 0.65,
  minVerifiedSimilarity = 0.58,
  minMargin = 0.05,
}) {
  if (!Array.isArray(metadata) || metadata.length === 0) {
    throw new Error("Scanner metadata must be a non-empty array");
  }
  assertPhysicalScannerEntries(metadata, `${game} browser source metadata`);
  if (vectorContents.byteLength < 8) {
    throw new Error("Packed vectors are missing their 8-byte header");
  }
  const count = vectorContents.readUInt32LE(0);
  const dimension = vectorContents.readUInt32LE(4);
  if (count !== metadata.length) {
    throw new Error(`Vector count ${count} does not match ${metadata.length} metadata rows`);
  }
  if (vectorContents.byteLength !== 8 + count * dimension) {
    throw new Error("Packed vector length does not match its header");
  }
  metadata.forEach((entry, index) => {
    if (entry.annIndex !== index) {
      throw new Error(`Metadata row ${index} has annIndex ${String(entry.annIndex)}`);
    }
    if (String(entry.game ?? "").toLowerCase() !== game) {
      throw new Error(`Metadata row ${index} belongs to ${String(entry.game)}`);
    }
  });
  const entries = metadata.map(browserEntry);
  return {
    version,
    kind: "embedding-index",
    model,
    dtype: "fp32",
    encoder: "arcface",
    dimension,
    tcg: game,
    quantization: "int8",
    scale: 127,
    normalized: true,
    total: entries.length,
    printingTotal: entries.reduce((sum, entry) => sum + entry.printings.length, 0),
    thresholds: { minSimilarity, minVerifiedSimilarity, minMargin },
    modelUrl: basename(modelFile),
    entries,
    vectors: vectorContents.subarray(8).toString("base64"),
  };
}

async function main() {
  const { values, flags } = parseCliArgs(process.argv.slice(2));
  if (flags.has("help")) return usage();
  const game = required(values, "game").toLowerCase();
  const metadataPath = resolve(required(values, "metadata"));
  const vectorsPath = resolve(required(values, "vectors"));
  const modelFile = required(values, "model-file");
  const outputPath = resolve(required(values, "output"));
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const artifact = buildBrowserIndex({
    metadata,
    vectorContents: await readFile(vectorsPath),
    game,
    version: positiveInteger(required(values, "version"), "version"),
    modelFile,
    model: values.get("model") ?? `tcger/arcface-fastvit-t8-${game}-full`,
    minSimilarity: finiteNumber(values, "min-similarity", 0.65),
    minVerifiedSimilarity: finiteNumber(values, "min-verified-similarity", 0.58),
    minMargin: finiteNumber(values, "min-margin", 0.05),
  });
  const serialized = `${JSON.stringify(artifact)}\n`;
  await writeFile(outputPath, serialized);
  console.log(JSON.stringify({
    output: outputPath,
    game,
    version: artifact.version,
    families: artifact.total,
    printings: artifact.printingTotal,
    dimension: artifact.dimension,
    bytes: Buffer.byteLength(serialized),
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
