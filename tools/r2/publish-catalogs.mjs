import { gzipSync } from "node:zlib";

import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import {
  bucketName,
  cleanPrefix,
  createR2Client,
  dataDirectory,
  isNotFound,
  loadCatalogManifest,
  loadVerifiedPack,
  parseCliArgs,
} from "./lib.mjs";

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const MANIFEST_CACHE = "public, max-age=300, must-revalidate";

function usage() {
  console.log(`Usage:
  npm run assets:r2:publish-catalogs -- [--bucket tcger-assets] [--prefix catalogs] [--data-dir data/catalog] [--dry-run]

Credentials:
  CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
  R2_BUCKET may be used instead of --bucket.`);
}

async function objectMatches(client, bucket, key, sha256) {
  try {
    const result = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return (
      result.Metadata?.["source-sha256"] === sha256 &&
      result.ContentEncoding === "gzip" &&
      result.CacheControl === IMMUTABLE_CACHE
    );
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function main() {
  const { values, flags } = parseCliArgs(process.argv.slice(2));
  if (flags.has("help") || flags.has("h")) {
    usage();
    return;
  }
  const known = new Set(["bucket", "prefix", "data-dir"]);
  for (const key of values.keys()) {
    if (!known.has(key)) throw new Error(`Unknown option: --${key}`);
  }
  for (const key of flags) {
    if (!new Set(["dry-run", "help", "h"]).has(key)) {
      throw new Error(`Unknown flag: --${key}`);
    }
  }

  const dryRun = flags.has("dry-run");
  const bucket = bucketName(values.get("bucket"), dryRun);
  const prefix = cleanPrefix(values.get("prefix"), "catalogs");
  const dataDir = dataDirectory(values.get("data-dir"));
  const client = createR2Client({ dryRun });
  const { manifest, contents: manifestContents } =
    await loadCatalogManifest(dataDir);
  const uploads = [];

  for (const [game, entry] of Object.entries(manifest.games).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const { contents } = await loadVerifiedPack(dataDir, entry);
    const key = `${prefix}/${entry.file}`;
    const body = gzipSync(contents, { level: 9 });
    uploads.push({
      game,
      key,
      rawBytes: contents.byteLength,
      transferBytes: body.byteLength,
    });
    if (dryRun) continue;
    if (await objectMatches(client, bucket, key, entry.sha256)) {
      console.log(JSON.stringify({ action: "skip", game, key }));
      continue;
    }
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "application/json; charset=utf-8",
        ContentEncoding: "gzip",
        CacheControl: IMMUTABLE_CACHE,
        StorageClass: "STANDARD",
        Metadata: { "source-sha256": entry.sha256 },
      }),
    );
    console.log(JSON.stringify({ action: "upload", game, key }));
  }

  const manifestKey = `${prefix}/manifest.json`;
  if (!dryRun) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: manifestKey,
        Body: manifestContents,
        ContentType: "application/json; charset=utf-8",
        CacheControl: MANIFEST_CACHE,
        StorageClass: "STANDARD",
      }),
    );
    console.log(JSON.stringify({ action: "upload", key: manifestKey }));
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        bucket,
        manifestKey,
        generatedAt: manifest.generatedAt,
        uploads,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
