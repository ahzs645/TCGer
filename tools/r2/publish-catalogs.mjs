import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

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
const POKEMON_ARTWORK_DIRECTORIES = [
  {
    directory: resolve(import.meta.dirname, "../../assets/pokemon/set-symbols"),
    keyPrefix: "pokemon-set-symbols",
  },
  {
    directory: resolve(
      import.meta.dirname,
      "../../assets/pokemon/rarity-symbols",
    ),
    keyPrefix: "pokemon-rarity-symbols",
  },
];

function usage() {
  console.log(`Usage:
  npm run assets:r2:publish-catalogs -- [--bucket tcger-assets] [--prefix catalogs] [--data-dir data/catalog] [--pokemon-vectors] [--dry-run]

Options:
  --pokemon-vectors  Publish imported Pokémon SVG artwork.

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

async function artworkObjectMatches(client, bucket, key, sha256, contentType) {
  try {
    const result = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return (
      result.Metadata?.["source-sha256"] === sha256 &&
      result.ContentType === contentType &&
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
    if (!new Set(["dry-run", "pokemon-vectors", "help", "h"]).has(key)) {
      throw new Error(`Unknown flag: --${key}`);
    }
  }

  const dryRun = flags.has("dry-run");
  const publishPokemonVectors = flags.has("pokemon-vectors");
  const bucket = bucketName(values.get("bucket"), dryRun);
  const prefix = cleanPrefix(values.get("prefix"), "catalogs");
  const dataDir = dataDirectory(values.get("data-dir"));
  const client = createR2Client({ dryRun });
  const { manifest, contents: manifestContents } =
    await loadCatalogManifest(dataDir);
  const uploads = [];

  if (publishPokemonVectors) {
    for (const artworkDirectory of POKEMON_ARTWORK_DIRECTORIES) {
      const artworkFiles = (await readdir(artworkDirectory.directory))
        .filter((filename) => filename.endsWith(".svg"))
        .sort();
      for (const filename of artworkFiles) {
        const contents = await readFile(
          resolve(artworkDirectory.directory, filename),
        );
        const sha256 = createHash("sha256").update(contents).digest("hex");
        const contentType = "image/svg+xml";
        const key = `${prefix}/${artworkDirectory.keyPrefix}/${filename}`;
        uploads.push({
          game: "pokemon-vector",
          key,
          rawBytes: contents.byteLength,
          transferBytes: contents.byteLength,
        });
        if (dryRun) continue;
        if (
          await artworkObjectMatches(client, bucket, key, sha256, contentType)
        ) {
          console.log(
            JSON.stringify({ action: "skip", game: "pokemon-vector", key }),
          );
          continue;
        }
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: contents,
            ContentType: contentType,
            CacheControl: IMMUTABLE_CACHE,
            StorageClass: "STANDARD",
            Metadata: { "source-sha256": sha256 },
          }),
        );
        console.log(
          JSON.stringify({ action: "upload", game: "pokemon-vector", key }),
        );
      }
    }
  }

  for (const [game, entry] of Object.entries(manifest.games).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const packs = [
      { kind: "cards", entry },
      ...(entry.sealedProducts
        ? [{ kind: "sealed-products", entry: entry.sealedProducts }]
        : []),
    ];
    for (const pack of packs) {
      const { contents } = await loadVerifiedPack(dataDir, pack.entry);
      const key = `${prefix}/${pack.entry.file}`;
      const body = gzipSync(contents, { level: 9 });
      uploads.push({
        game,
        kind: pack.kind,
        key,
        rawBytes: contents.byteLength,
        transferBytes: body.byteLength,
      });
      if (dryRun) continue;
      if (await objectMatches(client, bucket, key, pack.entry.sha256)) {
        console.log(JSON.stringify({ action: "skip", game, kind: pack.kind, key }));
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
          Metadata: { "source-sha256": pack.entry.sha256 },
        }),
      );
      console.log(JSON.stringify({ action: "upload", game, kind: pack.kind, key }));
    }
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
