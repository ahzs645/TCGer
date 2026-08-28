import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import {
  REPO_ROOT,
  assertPhysicalScannerEntries,
  bucketName,
  cleanPrefix,
  createR2Client,
  isNotFound,
  parseCliArgs,
  resolveWithin,
} from "./lib.mjs";

const execFileAsync = promisify(execFile);
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
// The browser/service worker provides offline fallback. Keeping this mutable
// pointer uncacheable means the next scanner start sees a completed publish.
const MANIFEST_CACHE = "public, max-age=0, must-revalidate";
const JSON_TYPE = "application/json; charset=utf-8";
const ONNX_TYPE = "application/octet-stream";

function usage() {
  console.log(`Usage:
  npm run assets:r2:publish-scan-index -- [--dry-run] [--wrangler]

Options:
  --source-dir  Generated artifact directory (default: frontend/public/scan-index).
  --prefix      R2 key prefix (default: scan-index).
  --bucket      R2 bucket (default: R2_BUCKET or tcger-assets).
  --wrangler    Publish with the current Wrangler login instead of S3 keys.
  --dry-run     Validate, hash, and print the exact publication plan only.

The publisher uploads immutable content-addressed model/index/gate objects
first and writes manifest.json last. Updating the ONNX bytes therefore gives
the browser a new model URL without invalidating old offline bundles.

S3 credentials:
  CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY`);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`);
}

function assertRecord(value, description) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be an object`);
  }
  return value;
}

async function readJson(path, description) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(
      `${description} is not readable JSON: ${error instanceof Error ? error.message : error}`,
    );
  }
}

async function optionalJson(path, description) {
  try {
    await stat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  return {
    value: await readJson(path, description),
    contents: await readFile(path),
  };
}

function localArtifactFilename(value, description) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${description} must be a local scan-index URL`);
  }
  const filename = value.trim().replace(/^\/scan-index\//, "");
  if (
    /^https?:\/\//i.test(filename) ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    throw new Error(
      `${description} must refer to a file in the source directory`,
    );
  }
  return filename;
}

function immutableAsset(
  prefix,
  extension,
  contentType,
  contents,
  { identityContents = contents, contentEncoding } = {},
) {
  const digest = sha256(identityContents);
  return {
    key: `${prefix}/objects/${digest}${extension}`,
    url: `objects/${digest}${extension}`,
    sha256: digest,
    contentType,
    contentEncoding,
    decodedBytes: identityContents.byteLength,
    cacheControl: IMMUTABLE_CACHE,
    contents,
  };
}

function validateManifestEntry(entry, description) {
  assertRecord(entry, description);
  if (
    typeof entry.tcg !== "string" ||
    typeof entry.file !== "string" ||
    typeof entry.version !== "number" ||
    typeof entry.encoder !== "string"
  ) {
    throw new Error(`${description} is missing tcg, file, version, or encoder`);
  }
  return entry;
}

async function buildPublicationPlan({
  sourceDir,
  prefix,
  generatedAt = new Date(),
}) {
  const sourceManifest = assertRecord(
    await readJson(
      resolveWithin(sourceDir, "manifest.json"),
      "Scan-index manifest",
    ),
    "Scan-index manifest",
  );
  if (sourceManifest.schema !== 1) {
    throw new Error("Scan-index manifest uses an unsupported schema");
  }
  const sourceIndexes = assertRecord(
    sourceManifest.indexes,
    "Manifest indexes",
  );
  if (!Array.isArray(sourceManifest.alternates)) {
    throw new Error("Scan-index manifest alternates must be an array");
  }

  const gateSource = await optionalJson(
    resolveWithin(sourceDir, "card-face-gate.json"),
    "Card-face gate",
  );
  let gateAsset = null;
  if (gateSource) {
    const gate = assertRecord(gateSource.value, "Card-face gate");
    if (
      typeof gate.model !== "string" ||
      typeof gate.dimension !== "number" ||
      !Array.isArray(gate.weights)
    ) {
      throw new Error("Card-face gate is missing model, dimension, or weights");
    }
    gateAsset = immutableAsset(prefix, ".json", JSON_TYPE, gateSource.contents);
  }

  const assets = new Map();
  const publishedBySourceFile = new Map();

  async function publishEntry(rawEntry, description) {
    const entry = validateManifestEntry(rawEntry, description);
    const existing = publishedBySourceFile.get(entry.file);
    if (existing) return existing;

    const sourceFile = localArtifactFilename(entry.file, `${description} file`);
    const artifact = assertRecord(
      await readJson(
        resolveWithin(sourceDir, sourceFile),
        `${description} artifact`,
      ),
      `${description} artifact`,
    );
    if (
      artifact.version !== entry.version ||
      artifact.encoder !== entry.encoder ||
      artifact.model !== entry.model ||
      artifact.dimension !== entry.dimension ||
      !Array.isArray(artifact.entries) ||
      typeof artifact.vectors !== "string"
    ) {
      throw new Error(`${description} does not match its index artifact`);
    }
    assertPhysicalScannerEntries(artifact.entries, `${description} browser entries`);

    const publishedArtifact = { ...artifact };
    if (artifact.encoder === "arcface") {
      const modelFilename = localArtifactFilename(
        artifact.modelUrl,
        `${description} modelUrl`,
      );
      const modelContents = await readFile(
        resolveWithin(sourceDir, modelFilename),
      );
      const modelAsset = immutableAsset(
        prefix,
        ".onnx",
        ONNX_TYPE,
        modelContents,
      );
      assets.set(modelAsset.key, modelAsset);
      publishedArtifact.modelUrl = modelAsset.url;
    }

    if (
      gateAsset &&
      gateSource.value.model === artifact.model &&
      gateSource.value.dimension === artifact.dimension
    ) {
      assets.set(gateAsset.key, gateAsset);
      publishedArtifact.gateUrl = gateAsset.url;
    } else {
      delete publishedArtifact.gateUrl;
    }

    const decodedIndex = jsonBuffer(publishedArtifact);
    const indexAsset = immutableAsset(
      prefix,
      ".json",
      JSON_TYPE,
      gzipSync(decodedIndex, { level: 9 }),
      { identityContents: decodedIndex, contentEncoding: "gzip" },
    );
    assets.set(indexAsset.key, indexAsset);
    const published = {
      ...entry,
      file: indexAsset.url,
      // Fetch transparently decodes Content-Encoding before diagnostics and
      // JSON parsing, so this is the decoded representation byte count.
      bytes: indexAsset.decodedBytes,
    };
    publishedBySourceFile.set(entry.file, published);
    return published;
  }

  const indexes = {};
  for (const [tcg, entry] of Object.entries(sourceIndexes)) {
    indexes[tcg] = await publishEntry(entry, `Active ${tcg} index`);
  }
  const alternates = [];
  for (const [index, entry] of sourceManifest.alternates.entries()) {
    alternates.push(await publishEntry(entry, `Alternate index ${index + 1}`));
  }

  const manifest = {
    ...sourceManifest,
    publishedAt: generatedAt.toISOString(),
    indexes,
    alternates,
  };
  const manifestAsset = {
    key: `${prefix}/manifest.json`,
    contentType: JSON_TYPE,
    cacheControl: MANIFEST_CACHE,
    contents: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
  };

  return { assets: [...assets.values()], manifest, manifestAsset };
}

async function objectMatches(client, bucket, asset) {
  try {
    const result = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: asset.key }),
    );
    return (
      result.Metadata?.["source-sha256"] === asset.sha256 &&
      result.ContentType === asset.contentType &&
      result.CacheControl === asset.cacheControl &&
      (result.ContentEncoding ?? undefined) === asset.contentEncoding
    );
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function uploadWithS3(client, bucket, asset) {
  if (await objectMatches(client, bucket, asset)) {
    console.log(JSON.stringify({ action: "skip", key: asset.key }));
    return;
  }
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: asset.key,
      Body: asset.contents,
      ContentType: asset.contentType,
      ContentEncoding: asset.contentEncoding,
      CacheControl: asset.cacheControl,
      StorageClass: "STANDARD",
      Metadata: { "source-sha256": asset.sha256 },
    }),
  );
  console.log(JSON.stringify({ action: "upload", key: asset.key }));
}

async function wranglerPut(bucket, asset, file) {
  const executable = resolve(
    REPO_ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler",
  );
  const arguments_ = [
      "r2",
      "object",
      "put",
      `${bucket}/${asset.key}`,
      "--file",
      file,
      "--content-type",
      asset.contentType,
      ...(asset.contentEncoding ? ["--content-encoding", asset.contentEncoding] : []),
      "--cache-control",
      asset.cacheControl,
      "--storage-class",
      "Standard",
      "--remote",
      "--force",
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
  if (flags.has("help") || flags.has("h")) {
    usage();
    return;
  }
  for (const key of values.keys()) {
    if (!new Set(["source-dir", "prefix", "bucket"]).has(key)) {
      throw new Error(`Unknown option: --${key}`);
    }
  }
  for (const key of flags) {
    if (!new Set(["dry-run", "wrangler", "help", "h"]).has(key)) {
      throw new Error(`Unknown flag: --${key}`);
    }
  }

  const dryRun = flags.has("dry-run");
  const useWrangler = flags.has("wrangler");
  const sourceDir = resolve(
    REPO_ROOT,
    values.get("source-dir") ?? "frontend/public/scan-index",
  );
  const prefix = cleanPrefix(values.get("prefix"), "scan-index");
  const bucket = bucketName(values.get("bucket"), dryRun || useWrangler);
  const plan = await buildPublicationPlan({ sourceDir, prefix });

  console.log(
    JSON.stringify(
      {
        dryRun,
        publisher: useWrangler ? "wrangler" : "s3",
        bucket,
        manifestKey: plan.manifestAsset.key,
        preferredEncoder: plan.manifest.preferredEncoder,
        activeIndexes: Object.fromEntries(
          Object.entries(plan.manifest.indexes).map(([tcg, entry]) => [
            tcg,
            {
              encoder: entry.encoder,
              version: entry.version,
              file: entry.file,
            },
          ]),
        ),
        objects: plan.assets.map((asset) => ({
          key: asset.key,
          bytes: asset.contents.byteLength,
          decodedBytes: asset.decodedBytes,
          contentEncoding: asset.contentEncoding,
          sha256: asset.sha256,
        })),
      },
      null,
      2,
    ),
  );
  if (dryRun) return;

  if (useWrangler) {
    const temporary = await mkdtemp(resolve(tmpdir(), "tcger-scan-index-r2-"));
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
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: plan.manifestAsset.key,
      Body: plan.manifestAsset.contents,
      ContentType: plan.manifestAsset.contentType,
      CacheControl: plan.manifestAsset.cacheControl,
      StorageClass: "STANDARD",
    }),
  );
  console.log(
    JSON.stringify({ action: "upload", key: plan.manifestAsset.key }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
