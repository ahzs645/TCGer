import { gzipSync } from "node:zlib";
import { createHash, createPublicKey, verify } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import {
  REPO_ROOT,
  bucketName,
  cleanPrefix,
  createR2Client,
  dataDirectory,
  isNotFound,
  loadCatalogManifest,
  loadVerifiedPack,
  parseCliArgs,
} from "./lib.mjs";

const execFileAsync = promisify(execFile);
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
  npm run assets:r2:publish-catalogs -- [--bucket tcger-assets] [--prefix catalogs] [--data-dir data/catalog] [--require-games pokemon,magic,...] [--pokemon-vectors] [--wrangler] [--allow-unsigned] [--check] [--dry-run]

Options:
  --pokemon-vectors  Publish imported Pokémon SVG artwork.
  --wrangler         Publish with the current Wrangler login instead of S3 keys.
  --allow-unsigned   Permit unsigned package manifests (development only).
  --check            Validate a signed release without uploading anything.
  --require-games    Require a comma-separated set of game ids in the index.

Credentials:
  CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
  R2_BUCKET may be used instead of --bucket.`);
}

async function wranglerPut(
  bucket,
  key,
  contents,
  { contentType, contentEncoding, cacheControl },
) {
  const executable = resolve(
    REPO_ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler",
  );
  const temporary = await mkdtemp(resolve(tmpdir(), "tcger-catalog-r2-"));
  const file = resolve(temporary, "object");
  try {
    await writeFile(file, contents);
    await execFileAsync(
      executable,
      [
        "r2",
        "object",
        "put",
        `${bucket}/${key}`,
        "--file",
        file,
        "--content-type",
        contentType,
        ...(contentEncoding ? ["--content-encoding", contentEncoding] : []),
        "--cache-control",
        cacheControl,
        "--storage-class",
        "Standard",
        "--remote",
        "--force",
      ],
      { cwd: REPO_ROOT, maxBuffer: 4 * 1024 * 1024 },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
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
  const known = new Set(["bucket", "prefix", "data-dir", "require-games"]);
  for (const key of values.keys()) {
    if (!known.has(key)) throw new Error(`Unknown option: --${key}`);
  }
  for (const key of flags) {
    if (
      !new Set([
        "dry-run",
        "pokemon-vectors",
        "wrangler",
        "allow-unsigned",
        "check",
        "help",
        "h",
      ]).has(key)
    ) {
      throw new Error(`Unknown flag: --${key}`);
    }
  }

  const dryRun = flags.has("dry-run");
  const checkOnly = flags.has("check");
  if (dryRun && checkOnly)
    throw new Error("Use either --check or --dry-run, not both");
  const publishPokemonVectors = flags.has("pokemon-vectors");
  const useWrangler = flags.has("wrangler");
  const allowUnsigned = flags.has("allow-unsigned") || dryRun;
  const noUpload = dryRun || checkOnly;
  const bucket = bucketName(values.get("bucket"), noUpload || useWrangler);
  const prefix = cleanPrefix(values.get("prefix"), "catalogs");
  const dataDir = dataDirectory(values.get("data-dir"));
  const client =
    useWrangler || noUpload ? undefined : createR2Client({ dryRun: false });
  const { manifest, contents: manifestContents } =
    await loadCatalogManifest(dataDir);
  const requiredGames = (values.get("require-games") ?? "")
    .split(",")
    .map((game) => game.trim())
    .filter(Boolean);
  if (requiredGames.some((game) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(game))) {
    throw new Error("--require-games contains an invalid game id");
  }
  const missingGames = requiredGames.filter((game) => !manifest.games[game]);
  if (missingGames.length) {
    throw new Error(
      `Catalog release is missing required games: ${missingGames.join(", ")}`,
    );
  }
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
        if (noUpload) continue;
        if (useWrangler) {
          await wranglerPut(bucket, key, contents, {
            contentType,
            cacheControl: IMMUTABLE_CACHE,
          });
        } else if (
          await artworkObjectMatches(client, bucket, key, sha256, contentType)
        ) {
          console.log(
            JSON.stringify({ action: "skip", game: "pokemon-vector", key }),
          );
          continue;
        }
        if (!useWrangler)
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

  const packagePublications = [];
  for (const [game, entry] of Object.entries(manifest.games).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    if (entry.packageFile) {
      const packageContents = await readFile(
        resolve(dataDir, entry.packageFile),
      );
      const packageManifest = JSON.parse(packageContents.toString("utf8"));
      if (
        packageManifest?.publisher?.id !== "tcger" ||
        packageManifest?.game?.id !== game ||
        packageManifest?.catalog?.asset?.sha256 !== entry.sha256
      ) {
        throw new Error(`Invalid official game package for ${game}`);
      }
      const key = `${prefix}/${entry.packageFile}`;
      let signaturePublication;
      if (packageManifest.signature || packageManifest.publisher?.signingKey) {
        const signingKey = packageManifest.publisher?.signingKey;
        const signatureMetadata = packageManifest.signature;
        if (
          signingKey?.algorithm !== "ed25519" ||
          signatureMetadata?.algorithm !== "ed25519" ||
          signingKey.id !== signatureMetadata.keyId
        ) {
          throw new Error(`Invalid signing metadata for ${game}`);
        }
        const signatureFile = signatureMetadata.url.replace(/^\.\//, "");
        if (
          !signatureFile ||
          signatureFile.includes("/") ||
          signatureFile.includes("\\")
        ) {
          throw new Error(`Unsafe signature filename for ${game}`);
        }
        const signatureContents = await readFile(
          resolve(dataDir, signatureFile),
        );
        const rawPublicKey = Buffer.from(signingKey.publicKey, "base64");
        if (
          rawPublicKey.byteLength !== 32 ||
          signatureContents.byteLength !== 64
        ) {
          throw new Error(`Invalid Ed25519 key or signature size for ${game}`);
        }
        const spki = Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          rawPublicKey,
        ]);
        if (
          !verify(
            null,
            packageContents,
            createPublicKey({ key: spki, format: "der", type: "spki" }),
            signatureContents,
          )
        ) {
          throw new Error(`Invalid package signature for ${game}`);
        }
        signaturePublication = {
          key: `${prefix}/${signatureFile}`,
          contents: signatureContents,
        };
      } else if (!allowUnsigned) {
        throw new Error(
          `Official package ${game} is unsigned; sign it or pass --allow-unsigned for development`,
        );
      }
      uploads.push({
        game,
        kind: "game-package",
        key,
        rawBytes: packageContents.byteLength,
        transferBytes: packageContents.byteLength,
      });
      packagePublications.push({
        game,
        key,
        contents: packageContents,
        signature: signaturePublication,
      });
    }
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
      if (noUpload) continue;
      if (useWrangler) {
        await wranglerPut(bucket, key, body, {
          contentType: "application/json; charset=utf-8",
          contentEncoding: "gzip",
          cacheControl: IMMUTABLE_CACHE,
        });
        console.log(
          JSON.stringify({ action: "upload", game, kind: pack.kind, key }),
        );
        continue;
      }
      if (await objectMatches(client, bucket, key, pack.entry.sha256)) {
        console.log(
          JSON.stringify({ action: "skip", game, kind: pack.kind, key }),
        );
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
      console.log(
        JSON.stringify({ action: "upload", game, kind: pack.kind, key }),
      );
    }
  }

  // Publish mutable pointers only after every immutable object they reference.
  for (const publication of packagePublications) {
    if (publication.signature) {
      uploads.push({
        game: publication.game,
        kind: "game-package-signature",
        key: publication.signature.key,
        rawBytes: publication.signature.contents.byteLength,
        transferBytes: publication.signature.contents.byteLength,
      });
      if (!noUpload) {
        if (useWrangler) {
          await wranglerPut(
            bucket,
            publication.signature.key,
            publication.signature.contents,
            {
              contentType: "application/octet-stream",
              cacheControl: MANIFEST_CACHE,
            },
          );
        } else {
          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: publication.signature.key,
              Body: publication.signature.contents,
              ContentType: "application/octet-stream",
              CacheControl: MANIFEST_CACHE,
              StorageClass: "STANDARD",
            }),
          );
        }
      }
    }
    if (!noUpload) {
      if (useWrangler) {
        await wranglerPut(bucket, publication.key, publication.contents, {
          contentType: "application/json; charset=utf-8",
          cacheControl: MANIFEST_CACHE,
        });
      } else {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: publication.key,
            Body: publication.contents,
            ContentType: "application/json; charset=utf-8",
            CacheControl: MANIFEST_CACHE,
            StorageClass: "STANDARD",
          }),
        );
      }
      console.log(
        JSON.stringify({
          action: "upload",
          game: publication.game,
          kind: "game-package",
          key: publication.key,
        }),
      );
    }
  }

  const manifestKey = `${prefix}/manifest.json`;
  if (!noUpload) {
    if (useWrangler) {
      await wranglerPut(bucket, manifestKey, manifestContents, {
        contentType: "application/json; charset=utf-8",
        cacheControl: MANIFEST_CACHE,
      });
    } else {
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
    }
    console.log(JSON.stringify({ action: "upload", key: manifestKey }));
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        checkOnly,
        bucket,
        manifestKey,
        generatedAt: manifest.generatedAt,
        requiredGames,
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
