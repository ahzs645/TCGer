import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import {
  REPO_ROOT,
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
  npm run assets:r2:publish-ios-scan-pack -- \\
    --game yugioh --version 1 \\
    --model-package /path/CardEmbeddings-arcface.mlpackage \\
    --vectors /path/CardsIndexVectors-arcface.bin \\
    --metadata /path/CardsIndexMetadata.json \\
    [--evaluation /path/arcface-eval.json] \\
    [--provenance /path/provenance.json] [--dry-run] [--wrangler]

The publisher validates the paired model/index metadata, uploads immutable
content-addressed objects first, and writes the per-game manifest last.`);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function contentType(path) {
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function immutableAsset(prefix, path, contents) {
  const digest = sha256(contents);
  const extension = path.includes(".") ? `.${path.split(".").pop()}` : ".bin";
  return {
    key: `${prefix}/objects/${digest}${extension}`,
    file: `objects/${digest}${extension}`,
    sha256: digest,
    bytes: contents.byteLength,
    contentType: contentType(path),
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

async function listFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (entry.isFile()) files.push({ path, relativePath: relative(root, path).split(sep).join("/") });
  }
  return files.sort((lhs, rhs) => lhs.relativePath.localeCompare(rhs.relativePath));
}

function validateRelativePath(path) {
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) {
    throw new Error(`Unsafe model package path: ${path}`);
  }
}

async function buildPlan(options) {
  const metadata = await readJson(options.metadata, "Scanner metadata");
  if (!Array.isArray(metadata) || metadata.length === 0) {
    throw new Error("Scanner metadata must be a non-empty array");
  }
  for (const [index, entry] of metadata.entries()) {
    if (entry.annIndex !== index) {
      throw new Error(`Scanner metadata annIndex mismatch at row ${index}`);
    }
    if (String(entry.game ?? "").toLowerCase() !== options.game) {
      throw new Error(`Scanner metadata row ${index} is not ${options.game}`);
    }
  }

  const vectors = await readFile(options.vectors);
  if (vectors.byteLength < 8) throw new Error("Packed vectors are missing their header");
  const count = vectors.readInt32LE(0);
  const dimension = vectors.readInt32LE(4);
  if (count !== metadata.length || dimension <= 0 || vectors.byteLength !== 8 + count * dimension) {
    throw new Error("Packed vector header/length does not match scanner metadata");
  }

  const modelStat = await stat(options.modelPackage);
  if (!modelStat.isDirectory() || !options.modelPackage.endsWith(".mlpackage")) {
    throw new Error("--model-package must be an extracted .mlpackage directory");
  }
  const modelFiles = await listFiles(options.modelPackage);
  if (!modelFiles.some((entry) => entry.relativePath === "Manifest.json")) {
    throw new Error("Core ML package is missing Manifest.json");
  }

  const assets = [];
  const model = [];
  for (const source of modelFiles) {
    validateRelativePath(source.relativePath);
    const asset = immutableAsset(options.prefix, source.relativePath, await readFile(source.path));
    assets.push(asset);
    model.push({
      relativePath: source.relativePath,
      file: asset.file,
      bytes: asset.bytes,
      sha256: asset.sha256,
    });
  }

  const vectorAsset = immutableAsset(options.prefix, basename(options.vectors), vectors);
  const metadataAsset = immutableAsset(
    options.prefix,
    basename(options.metadata),
    await readFile(options.metadata),
  );
  assets.push(vectorAsset, metadataAsset);

  const evaluation = options.evaluation
    ? await readJson(options.evaluation, "Evaluation result")
    : null;
  const provenance = options.provenance
    ? await readJson(options.provenance, "Catalog provenance")
    : null;
  const downloadBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  const manifest = {
    formatVersion: 1,
    game: options.game,
    version: options.version,
    generatedAt: new Date().toISOString(),
    encoder: "arcface",
    modelName: "CardEmbeddings-arcface",
    cardCount: count,
    dimension,
    downloadBytes,
    modelPackage: model,
    vectors: {
      file: vectorAsset.file,
      bytes: vectorAsset.bytes,
      sha256: vectorAsset.sha256,
    },
    metadata: {
      file: metadataAsset.file,
      bytes: metadataAsset.bytes,
      sha256: metadataAsset.sha256,
    },
    evaluation,
    provenance,
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

async function objectMatches(client, bucket, asset) {
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: asset.key }));
    return result.Metadata?.["source-sha256"] === asset.sha256;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function uploadWithS3(client, bucket, asset) {
  if (asset.sha256 && (await objectMatches(client, bucket, asset))) {
    console.log(JSON.stringify({ action: "skip", key: asset.key }));
    return;
  }
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: asset.key,
    Body: asset.contents,
    ContentType: asset.contentType,
    CacheControl: asset.cacheControl,
    StorageClass: "STANDARD",
    Metadata: asset.sha256 ? { "source-sha256": asset.sha256 } : undefined,
  }));
  console.log(JSON.stringify({ action: "upload", key: asset.key }));
}

async function wranglerPut(bucket, asset, file) {
  const executable = resolve(REPO_ROOT, "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
  const arguments_ = [
    "r2", "object", "put", `${bucket}/${asset.key}`,
    "--file", file,
    "--content-type", asset.contentType,
    "--cache-control", asset.cacheControl,
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
  console.log(JSON.stringify({ action: "upload", key: asset.key }));
}

async function main() {
  const { values, flags } = parseCliArgs(process.argv.slice(2));
  if (flags.has("help") || flags.has("h")) return usage();
  const allowedValues = new Set([
    "game", "version", "model-package", "vectors", "metadata", "evaluation",
    "provenance", "prefix", "bucket",
  ]);
  for (const key of values.keys()) if (!allowedValues.has(key)) throw new Error(`Unknown option: --${key}`);
  for (const key of flags) if (!new Set(["dry-run", "wrangler", "help", "h"]).has(key)) throw new Error(`Unknown flag: --${key}`);

  const required = ["game", "version", "model-package", "vectors", "metadata"];
  for (const key of required) if (!values.get(key)) throw new Error(`Missing --${key}`);
  const game = values.get("game").toLowerCase();
  if (!/^[a-z0-9-]+$/.test(game)) throw new Error("--game must be a lowercase key");
  const version = Number.parseInt(values.get("version"), 10);
  if (!Number.isSafeInteger(version) || version <= 0) throw new Error("--version must be a positive integer");

  const dryRun = flags.has("dry-run");
  const useWrangler = flags.has("wrangler");
  const prefix = cleanPrefix(values.get("prefix"), "ios/scan-assets");
  const bucket = bucketName(values.get("bucket"), dryRun || useWrangler);
  const plan = await buildPlan({
    game,
    version,
    prefix,
    modelPackage: resolve(values.get("model-package")),
    vectors: resolve(values.get("vectors")),
    metadata: resolve(values.get("metadata")),
    evaluation: values.get("evaluation") ? resolve(values.get("evaluation")) : null,
    provenance: values.get("provenance") ? resolve(values.get("provenance")) : null,
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
    const temporary = await mkdtemp(resolve(tmpdir(), "tcger-ios-scan-r2-"));
    try {
      for (const [index, asset] of plan.assets.entries()) {
        const file = resolve(temporary, `asset-${index}`);
        await writeFile(file, asset.contents);
        await wranglerPut(bucket, asset, file);
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
  for (const asset of plan.assets) await uploadWithS3(client, bucket, asset);
  await uploadWithS3(client, bucket, plan.manifestAsset);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
