import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";

import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import {
  REPO_ROOT,
  assertPhysicalScannerEntries,
  bucketName,
  cleanPrefix,
  createR2Client,
  isNotFound,
  parseCliArgs,
} from "./lib.mjs";

const execFileAsync = promisify(execFile);
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const MANIFEST_CACHE = "public, max-age=0, must-revalidate";

function usage() {
  console.log(`Usage:
  npm run assets:r2:publish-android-scan-pack -- \\
    --game yugioh --version 1 \\
    --model /path/card-embeddings-arcface-fp32.onnx \\
    --vectors /path/CardsIndexVectors-arcface.bin \\
    --metadata /path/CardsIndexMetadata.json \\
    [--onnx-eval /path/android-onnx-eval.json] \\
    [--operating-point-status provisional-explicit-mode-only] \\
    [--dry-run] [--wrangler]`);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function asset(prefix, path, contents) {
  const digest = sha256(contents);
  const extension = path.includes(".") ? `.${path.split(".").pop()}` : ".bin";
  return {
    key: `${prefix}/objects/${digest}${extension}`,
    file: `objects/${digest}${extension}`,
    bytes: contents.byteLength,
    sha256: digest,
    contentType: path.endsWith(".json")
      ? "application/json; charset=utf-8"
      : "application/octet-stream",
    cacheControl: IMMUTABLE_CACHE,
    contents,
  };
}

async function readJson(path, description) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${description} is not readable JSON: ${error.message}`);
  }
}

async function buildPlan(options) {
  const [modelContents, vectorContents, metadataContents] = await Promise.all([
    readFile(options.model),
    readFile(options.vectors),
    readFile(options.metadata),
  ]);
  const metadata = JSON.parse(metadataContents.toString("utf8"));
  if (!Array.isArray(metadata) || metadata.length === 0) {
    throw new Error("Scanner metadata must be a non-empty array");
  }
  assertPhysicalScannerEntries(metadata, "Android scanner metadata");
  for (const [index, row] of metadata.entries()) {
    if (row.annIndex !== index || String(row.game ?? "").toLowerCase() !== options.game) {
      throw new Error(`Scanner metadata row ${index} does not match ${options.game}`);
    }
    if (!Array.isArray(row.printings) || row.printings.length === 0) {
      throw new Error(`Scanner metadata family ${index} has no exact printings`);
    }
  }
  if (vectorContents.byteLength < 8) throw new Error("Packed vectors have no header");
  const count = vectorContents.readInt32LE(0);
  const dimension = vectorContents.readInt32LE(4);
  if (
    count !== metadata.length ||
    dimension <= 0 ||
    vectorContents.byteLength !== 8 + count * dimension
  ) {
    throw new Error("Packed vectors do not match metadata");
  }

  let evaluation = null;
  if (options.onnxEval) {
    evaluation = await readJson(options.onnxEval, "Android ONNX evaluation");
    if (
      evaluation?.onnx?.sha256 !== sha256(modelContents) ||
      evaluation?.onnx?.bytes !== modelContents.byteLength ||
      evaluation?.model?.dimension !== dimension
    ) {
      throw new Error("Android ONNX evaluation does not match the model/index");
    }
  }

  const model = asset(options.prefix, basename(options.model), modelContents);
  const vectors = asset(options.prefix, basename(options.vectors), vectorContents);
  const metadataAsset = asset(options.prefix, basename(options.metadata), metadataContents);
  const assets = [model, vectors, metadataAsset];
  const manifest = {
    formatVersion: 2,
    game: options.game,
    version: options.version,
    generatedAt: new Date().toISOString(),
    encoder: "arcface",
    modelName: "card-embeddings-arcface-fp32",
    cardCount: count,
    printingCount: metadata.reduce((sum, row) => sum + row.printings.length, 0),
    metadataSchema: "tcger-cards-index-metadata-v3",
    recognitionContract: "tcger-two-stage-recognition-v2",
    dimension,
    downloadBytes: assets.reduce((sum, item) => sum + item.bytes, 0),
    strongAcceptanceScore: options.strongAcceptanceScore,
    ambiguityMargin: options.ambiguityMargin,
    operatingPointStatus: options.operatingPointStatus,
    model: { file: model.file, bytes: model.bytes, sha256: model.sha256 },
    vectors: { file: vectors.file, bytes: vectors.bytes, sha256: vectors.sha256 },
    metadata: {
      file: metadataAsset.file,
      bytes: metadataAsset.bytes,
      sha256: metadataAsset.sha256,
    },
    evaluation,
  };
  const manifestContents = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  return {
    assets,
    manifest,
    manifestAsset: {
      key: `${options.prefix}/${options.game}/manifest.json`,
      bytes: manifestContents.byteLength,
      contentType: "application/json; charset=utf-8",
      cacheControl: MANIFEST_CACHE,
      contents: manifestContents,
    },
  };
}

async function objectMatches(client, bucket, item) {
  try {
    const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: item.key }));
    return response.Metadata?.["source-sha256"] === item.sha256;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function uploadWithS3(client, bucket, item) {
  if (item.sha256 && (await objectMatches(client, bucket, item))) {
    console.log(JSON.stringify({ action: "skip", key: item.key }));
    return;
  }
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: item.key,
    Body: item.contents,
    ContentType: item.contentType,
    CacheControl: item.cacheControl,
    StorageClass: "STANDARD",
    Metadata: item.sha256 ? { "source-sha256": item.sha256 } : undefined,
  }));
  console.log(JSON.stringify({ action: "upload", key: item.key }));
}

async function wranglerPut(bucket, item, file) {
  const executable = resolve(
    REPO_ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler",
  );
  const arguments_ = [
    "r2", "object", "put", `${bucket}/${item.key}`,
    "--file", file,
    "--content-type", item.contentType,
    "--cache-control", item.cacheControl,
    "--storage-class", "Standard",
    "--remote", "--force",
  ];
  for (let attempt = 1; ; attempt++) {
    try {
      await execFileAsync(executable, arguments_, { cwd: REPO_ROOT, maxBuffer: 4 * 1024 * 1024 });
      break;
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000 * 2 ** (attempt - 1)));
    }
  }
  console.log(JSON.stringify({ action: "upload", key: item.key }));
}

async function main() {
  const { values, flags } = parseCliArgs(process.argv.slice(2));
  if (flags.has("help") || flags.has("h")) return usage();
  const valueNames = new Set([
    "game", "version", "model", "vectors", "metadata", "onnx-eval",
    "prefix", "bucket", "strong-acceptance-score", "ambiguity-margin", "operating-point-status",
  ]);
  for (const key of values.keys()) if (!valueNames.has(key)) throw new Error(`Unknown option: --${key}`);
  for (const key of flags) if (!new Set(["dry-run", "wrangler", "help", "h"]).has(key)) throw new Error(`Unknown flag: --${key}`);
  for (const key of ["game", "version", "model", "vectors", "metadata"]) {
    if (!values.get(key)) throw new Error(`Missing --${key}`);
  }
  const game = values.get("game").toLowerCase();
  if (!/^[a-z0-9-]+$/.test(game)) throw new Error("--game must be a lowercase key");
  const version = Number.parseInt(values.get("version"), 10);
  if (!Number.isSafeInteger(version) || version <= 0) throw new Error("--version must be positive");
  const strongAcceptanceScore = Number(values.get("strong-acceptance-score") ?? "0.60");
  const ambiguityMargin = Number(values.get("ambiguity-margin") ?? "0.05");
  const operatingPointStatus = values.get("operating-point-status") ?? "provisional-explicit-mode-only";
  if (!(strongAcceptanceScore > 0 && strongAcceptanceScore <= 1)) throw new Error("invalid strong acceptance score");
  if (!(ambiguityMargin >= 0 && ambiguityMargin <= 1)) throw new Error("invalid ambiguity margin");

  const dryRun = flags.has("dry-run");
  const useWrangler = flags.has("wrangler");
  const prefix = cleanPrefix(values.get("prefix"), "android/scan-assets");
  const bucket = bucketName(values.get("bucket"), dryRun || useWrangler);
  const plan = await buildPlan({
    game,
    version,
    prefix,
    strongAcceptanceScore,
    ambiguityMargin,
    operatingPointStatus,
    model: resolve(values.get("model")),
    vectors: resolve(values.get("vectors")),
    metadata: resolve(values.get("metadata")),
    onnxEval: values.get("onnx-eval") ? resolve(values.get("onnx-eval")) : null,
  });
  console.log(JSON.stringify({
    dryRun,
    publisher: useWrangler ? "wrangler" : "s3",
    bucket,
    manifestKey: plan.manifestAsset.key,
    game,
    version,
    cardCount: plan.manifest.cardCount,
    dimension: plan.manifest.dimension,
    downloadBytes: plan.manifest.downloadBytes,
    objects: plan.assets.map(({ key, bytes, sha256 }) => ({ key, bytes, sha256 })),
  }, null, 2));
  if (dryRun) return;

  if (useWrangler) {
    const temporary = await mkdtemp(resolve(tmpdir(), "tcger-android-scan-r2-"));
    try {
      for (const [index, item] of plan.assets.entries()) {
        const file = resolve(temporary, `asset-${index}`);
        await writeFile(file, item.contents);
        await wranglerPut(bucket, item, file);
      }
      const manifestFile = resolve(temporary, "manifest.json");
      await writeFile(manifestFile, plan.manifestAsset.contents);
      await wranglerPut(bucket, plan.manifestAsset, manifestFile);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    return;
  }

  const client = createR2Client({ dryRun: false });
  for (const item of plan.assets) await uploadWithS3(client, bucket, item);
  await uploadWithS3(client, bucket, plan.manifestAsset);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
