import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import {
  REPO_ROOT,
  bucketName,
  createR2Client,
  isNotFound,
  parseCliArgs,
} from "./lib.mjs";

const execFileAsync = promisify(execFile);
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const MANIFEST_CACHE = "public, max-age=300, must-revalidate";
const PACK_ROOT = "pack";
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CONTENT_TYPES = new Map([
  [".obj", "text/plain; charset=utf-8"],
  [".png", "image/png"],
]);

function usage() {
  console.log(`Usage:
  npm run assets:r2:publish-pack-assets -- --projected-dir <Google Drive folder> [--dry-run] [--wrangler]
  npm run assets:r2:publish-pack-assets -- --source-manifest <manifest.json> [--dry-run] [--wrangler]

Options:
  --projected-dir  Folder containing the studio's projected cover exports.
                   PACK_PROJECTED_DIR may be used instead.
  --source-manifest
                   Migrate covers already described by a local pack manifest.
                   The cover files are read only for upload and must be removed
                   from Git after publication.
  --bucket         R2 bucket (default: R2_BUCKET or tcger-assets).
  --wrangler       Publish with the current Wrangler login instead of S3 keys.
  --dry-run        Validate and print the exact object plan without uploading.

S3 credentials:
  CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY`);
}

function resolveInside(root, path, description) {
  if (typeof path !== "string" || !path || isAbsolute(path)) {
    throw new Error(`${description} must be a non-empty relative path`);
  }
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, path);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`${description} escapes its source directory: ${path}`);
  }
  return target;
}

async function loadJson(path, description) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(
      `${description} is not readable JSON: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function readPngSize(contents, description) {
  if (
    contents.byteLength < 24 ||
    !contents.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw new Error(`${description} is not a PNG`);
  }
  return [contents.readUInt32BE(16), contents.readUInt32BE(20)];
}

async function findManifestEntries(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await findManifestEntries(path)));
    else if (entry.isFile() && entry.name === "manifest.entry.json") found.push(path);
  }
  return found.sort();
}

function validateCover(id, cover, manifestPath) {
  const sourceName = relative(REPO_ROOT, manifestPath);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`${sourceName} contains an invalid pack cover id: ${id}`);
  }
  if (typeof cover?.label !== "string" || !cover.label.trim()) {
    throw new Error(`${sourceName} has no label for ${id}`);
  }
  if (typeof cover.plain !== "string" || !cover.plain.startsWith("/pack/")) {
    throw new Error(`${sourceName} has an invalid plain asset path for ${id}`);
  }
  if (
    cover.packPool !== undefined &&
    (typeof cover.packPool !== "string" || !cover.packPool.trim())
  ) {
    throw new Error(`${sourceName} has an invalid pack pool for ${id}`);
  }
  if (
    cover.accentVariant !== undefined &&
    (typeof cover.accentVariant !== "string" || !cover.accentVariant.trim())
  ) {
    throw new Error(`${sourceName} has an invalid accent variant for ${id}`);
  }
}

function coverMetadata(cover) {
  return {
    label: cover.label.trim(),
    ...(cover.packPool ? { packPool: cover.packPool.trim() } : {}),
    ...(cover.setCode ? { setCode: cover.setCode.trim() } : {}),
    ...(cover.setName ? { setName: cover.setName.trim() } : {}),
    ...(cover.variationLabel
      ? { variationLabel: cover.variationLabel.trim() }
      : {}),
    ...(cover.accentVariant
      ? { accentVariant: cover.accentVariant.trim() }
      : {}),
  };
}

function objectIdentity(contents, sourcePath) {
  const sha256 = createHash("sha256").update(contents).digest("hex");
  const extension = extname(sourcePath).toLowerCase();
  const contentType = CONTENT_TYPES.get(extension);
  if (!contentType)
    throw new Error(`Unsupported pack asset type: ${extension}`);
  return {
    sha256,
    extension,
    contentType,
    key: `${PACK_ROOT}/objects/${sha256}${extension}`,
  };
}

async function objectMatches(client, bucket, asset) {
  try {
    const result = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: asset.key }),
    );
    return (
      result.ContentType === asset.contentType &&
      result.CacheControl === IMMUTABLE_CACHE
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
      CacheControl: IMMUTABLE_CACHE,
      StorageClass: "STANDARD",
      Metadata: { "source-sha256": asset.sha256 },
    }),
  );
  console.log(JSON.stringify({ action: "upload", key: asset.key }));
}

async function wranglerPut(bucket, key, file, contentType, cacheControl) {
  const executable = resolve(
    REPO_ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler",
  );
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
      "--cache-control",
      cacheControl,
      "--storage-class",
      "Standard",
      "--remote",
      "--force",
    ],
    { cwd: REPO_ROOT, maxBuffer: 4 * 1024 * 1024 },
  );
  console.log(JSON.stringify({ action: "upload", key }));
}

async function wranglerGet(bucket, key, file) {
  const executable = resolve(
    REPO_ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler",
  );
  await execFileAsync(
    executable,
    ["r2", "object", "get", `${bucket}/${key}`, "--file", file, "--remote"],
    { cwd: REPO_ROOT, maxBuffer: 4 * 1024 * 1024 },
  );
}

async function existingManifest({ bucket, client, useWrangler, temporary }) {
  const key = `${PACK_ROOT}/manifest.json`;
  if (useWrangler) {
    const file = resolve(temporary, "existing-manifest.json");
    await wranglerGet(bucket, key, file);
    return loadJson(file, "Existing R2 pack manifest");
  }
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return JSON.parse(await result.Body.transformToString());
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function main() {
  const { values, flags } = parseCliArgs(process.argv.slice(2));
  if (flags.has("help") || flags.has("h")) {
    usage();
    return;
  }
  const knownValues = new Set(["projected-dir", "source-manifest", "bucket"]);
  for (const key of values.keys()) {
    if (!knownValues.has(key)) throw new Error(`Unknown option: --${key}`);
  }
  for (const key of flags) {
    if (!new Set(["dry-run", "wrangler", "help", "h"]).has(key)) {
      throw new Error(`Unknown flag: --${key}`);
    }
  }

  const dryRun = flags.has("dry-run");
  const useWrangler = flags.has("wrangler");
  const projectedValue =
    values.get("projected-dir") ?? process.env.PACK_PROJECTED_DIR;
  const sourceManifestValue = values.get("source-manifest");
  if (!!projectedValue?.trim() === !!sourceManifestValue?.trim()) {
    throw new Error(
      "Pass exactly one of --projected-dir (or PACK_PROJECTED_DIR) and --source-manifest",
    );
  }
  const projectedDir = projectedValue?.trim() ? resolve(projectedValue) : null;
  const coreDir = resolve(REPO_ROOT, "packages/pack-core/assets/pack");
  const coreManifest = await loadJson(
    resolve(coreDir, "manifest.json"),
    "Pack-core manifest",
  );
  const sourceAssets = [
    {
      kind: "mesh",
      source: resolveInside(
        coreDir,
        coreManifest.mesh.replace(/^\/pack\//, ""),
        "Mesh path",
      ),
    },
  ];
  const covers = {};
  const sourceManifestPath = sourceManifestValue?.trim()
    ? resolve(sourceManifestValue)
    : null;
  const entryFiles = sourceManifestPath
    ? [sourceManifestPath]
    : await findManifestEntries(projectedDir);
  if (entryFiles.length === 0)
    throw new Error(`No manifest.entry.json files found in ${projectedDir}`);
  for (const manifestPath of entryFiles) {
    const sourceManifest = await loadJson(
      manifestPath,
      sourceManifestPath ? "Pack source manifest" : "Pack cover manifest entry",
    );
    const entries = sourceManifestPath ? sourceManifest.covers : sourceManifest;
    if (!entries || Array.isArray(entries) || typeof entries !== "object") {
      throw new Error(`${manifestPath} must contain a cover object`);
    }
    for (const [id, cover] of Object.entries(entries)) {
      validateCover(id, cover, manifestPath);
      if (covers[id]) throw new Error(`Duplicate pack cover id: ${id}`);
      const source = resolveInside(
        dirname(manifestPath),
        cover.plain.replace(/^\/pack\//, ""),
        `${id} file`,
      );
      sourceAssets.push({ kind: "cover", id, source });
      covers[id] = coverMetadata(cover);
    }
  }

  const assets = [];
  for (const sourceAsset of sourceAssets) {
    const contents = await readFile(sourceAsset.source);
    const identity = objectIdentity(contents, sourceAsset.source);
    if (sourceAsset.kind === "cover") {
      const size = readPngSize(contents, sourceAsset.id);
      if (size[0] !== 1024 || size[1] !== 512) {
        throw new Error(
          `${sourceAsset.id} must be 1024x512, got ${size.join("x")}`,
        );
      }
      const url = `/${identity.key}`;
      covers[sourceAsset.id] = {
        ...covers[sourceAsset.id],
        plain: url,
        decaled: url,
        size,
        base: null,
        decal: null,
      };
    }
    assets.push({ ...sourceAsset, ...identity, contents });
  }

  const meshAsset = assets.find((asset) => asset.kind === "mesh");
  const manifestKey = `${PACK_ROOT}/manifest.json`;
  const bucket = bucketName(values.get("bucket"), dryRun || useWrangler);
  // A credential-free dry run can still validate and hash the incoming source.
  // The existing manifest is read during every real publication (and Wrangler
  // dry runs), immediately before the merged manifest is constructed.
  const client = useWrangler ? undefined : createR2Client({ dryRun });
  const temporary = await mkdtemp(resolve(tmpdir(), "tcger-pack-r2-"));
  let previousManifest;
  try {
    previousManifest =
      dryRun && !useWrangler
        ? null
        : await existingManifest({ bucket, client, useWrangler, temporary });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw new Error(
      `Could not preserve the existing R2 pack manifest: ${error instanceof Error ? error.message : error}`,
    );
  }
  const manifest = {
    mesh: `/${meshAsset.key}`,
    rim: coreManifest.rim,
    covers: { ...(previousManifest?.covers ?? {}), ...covers },
    bases: previousManifest?.bases ?? {},
    decals: previousManifest?.decals ?? {},
  };
  const manifestContents = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        dryRun,
        publisher: useWrangler ? "wrangler" : "s3",
        bucket,
        source: sourceManifestPath
          ? relative(REPO_ROOT, sourceManifestPath)
          : basename(projectedDir),
        discoveredManifests: entryFiles.map((path) =>
          relative(projectedDir ?? dirname(sourceManifestPath), path),
        ),
        manifestKey,
        publishedCovers: Object.keys(covers),
        preservedCovers: Object.keys(previousManifest?.covers ?? {}).filter(
          (id) => !covers[id],
        ),
        objects: assets.map((asset) => ({
          key: asset.key,
          bytes: asset.contents.byteLength,
          sha256: asset.sha256,
        })),
      },
      null,
      2,
    ),
  );
  if (dryRun) {
    await rm(temporary, { recursive: true, force: true });
    return;
  }

  if (useWrangler) {
    try {
      for (const [index, asset] of assets.entries()) {
        const file = resolve(temporary, `${index}${asset.extension}`);
        await writeFile(file, asset.contents);
        await wranglerPut(
          bucket,
          asset.key,
          file,
          asset.contentType,
          IMMUTABLE_CACHE,
        );
      }
      const manifestFile = resolve(temporary, "manifest.json");
      await writeFile(manifestFile, manifestContents);
      await wranglerPut(
        bucket,
        manifestKey,
        manifestFile,
        "application/json; charset=utf-8",
        MANIFEST_CACHE,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    return;
  }

  try {
    for (const asset of assets) await uploadWithS3(client, bucket, asset);
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
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
