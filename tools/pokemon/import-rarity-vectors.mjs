import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const requireFromBackend = createRequire(
  resolve(REPO_ROOT, "backend/package.json"),
);
const sharp = requireFromBackend("sharp");
const DEFAULT_SOURCE = resolve(
  process.env.HOME ?? "",
  "Downloads/Pokémon TCG Vectors/Rarities",
);
const OUTPUT_DIRECTORY = resolve(REPO_ROOT, "assets/pokemon/rarity-symbols");
const IOS_ASSET_CATALOG_DIRECTORY = resolve(
  REPO_ROOT,
  "mobile-apps/ios/TCGer/TCGer/Assets.xcassets/PokemonRarities",
);
const LEGACY_IOS_RESOURCE_DIRECTORY = resolve(
  REPO_ROOT,
  "mobile-apps/ios/TCGer/TCGer/Resources/PokemonRarities",
);
const GENERATED_SWIFT = resolve(
  REPO_ROOT,
  "mobile-apps/ios/TCGer/TCGer/Views/Components/PokemonRarityArtwork.generated.swift",
);
const PUBLIC_ROOT =
  "https://assets.tcger.ahmadjalil.com/catalogs/pokemon-rarity-symbols";

// Only map labels whose meaning matches the supplied artwork exactly. Modern
// Scarlet & Violet and Pocket rarities deliberately remain text-only until a
// trustworthy source for their distinct symbols is available.
const ARTWORK = Object.freeze([
  {
    key: "amazing-rare",
    source: "Amazing Rare Holo",
    labels: ["Amazing Rare"],
  },
  { key: "common", source: "Common", labels: ["Common"] },
  { key: "uncommon", source: "Uncommon", labels: ["Uncommon"] },
  { key: "rare", source: "Rare", labels: ["Rare"] },
  { key: "rare-holo", source: "Rare Holo", labels: ["Holo Rare", "Rare Holo"] },
  {
    key: "shiny-rare",
    source: "Rare Shiny",
    labels: ["Shiny Rare", "Shiny rare"],
  },
  {
    key: "shiny-ultra-rare",
    source: "Ultra Rare Shiny",
    labels: ["Shiny Ultra Rare"],
  },
  { key: "ultra-rare", source: "Ultra Rare", labels: ["Ultra Rare"] },
  { key: "promo", source: "Promo", labels: ["Promo"] },
]);

function parseSourceArgument(argv) {
  const sourceIndex = argv.indexOf("--source");
  if (sourceIndex === -1) return DEFAULT_SOURCE;
  const value = argv[sourceIndex + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--source requires the rarity directory path");
  }
  return resolve(value);
}

function hash(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function validateSVG(contents, filename) {
  if (!/^\s*<svg\b/i.test(contents) || !/\bviewBox\s*=/i.test(contents)) {
    throw new Error(`${filename} is not a self-sizing SVG`);
  }
  const rejected = [
    /<script\b/i,
    /javascript:/i,
    /<image\b/i,
    /<foreignObject\b/i,
    /<use\b/i,
    /<text\b/i,
    /@import/i,
    /(?:xlink:)?href\s*=/i,
    /url\((?!\s*#)/i,
  ];
  if (rejected.some((pattern) => pattern.test(contents))) {
    throw new Error(`${filename} contains a disallowed SVG feature`);
  }
  if (Buffer.byteLength(contents) > 100_000) {
    throw new Error(`${filename} exceeds the 100 KB asset limit`);
  }
}

function cropArchivePadding(contents) {
  return contents.replace(
    /viewBox=(['"])0\s+0\s+3000\s+1000\1/i,
    'viewBox="0 0 1125 1000"',
  );
}

function swiftString(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function assetName(key) {
  const suffix = key
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
  return `PokemonRarity${suffix}`;
}

async function readSourceSVG(sourceDirectory, entry) {
  const archiveFilename = `${entry.source}.svg`;
  try {
    return {
      contents: await readFile(
        resolve(sourceDirectory, archiveFilename),
        "utf8",
      ),
      filename: archiveFilename,
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  // Allow a checked-in, content-addressed rarity directory to regenerate all
  // derived outputs without requiring the original user-provided archive.
  const candidates = (await readdir(sourceDirectory)).filter(
    (filename) =>
      filename.startsWith(`${entry.key}.`) && filename.endsWith(".svg"),
  );
  if (candidates.length !== 1) {
    throw new Error(
      `${archiveFilename} is missing and expected exactly one ${entry.key}.*.svg fallback`,
    );
  }
  return {
    contents: await readFile(resolve(sourceDirectory, candidates[0]), "utf8"),
    filename: candidates[0],
  };
}

async function renderFallbackPNG(vectorContents) {
  return sharp(Buffer.from(vectorContents), { density: 384 })
    .resize(128, 128, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function main() {
  const sourceDirectory = parseSourceArgument(process.argv.slice(2));
  const imported = [];

  for (const entry of ARTWORK) {
    const source = await readSourceSVG(sourceDirectory, entry);
    const vectorContents = cropArchivePadding(source.contents);
    validateSVG(vectorContents, source.filename);
    const vectorSha256 = hash(vectorContents);
    const vectorFilename = `${entry.key}.${vectorSha256.slice(0, 16)}.svg`;
    const rasterContents = await renderFallbackPNG(vectorContents);
    const rasterSha256 = hash(rasterContents);
    const rasterFilename = `${entry.key}.${rasterSha256.slice(0, 16)}.png`;

    imported.push({
      ...entry,
      assetName: assetName(entry.key),
      sourceFile: `${entry.source}.svg`,
      vectorContents,
      vectorFilename,
      vectorSha256,
      rasterContents,
      rasterFilename,
      rasterSha256,
    });
  }

  await Promise.all([
    rm(OUTPUT_DIRECTORY, { recursive: true, force: true }),
    rm(IOS_ASSET_CATALOG_DIRECTORY, { recursive: true, force: true }),
    rm(LEGACY_IOS_RESOURCE_DIRECTORY, { recursive: true, force: true }),
  ]);
  await Promise.all([
    mkdir(OUTPUT_DIRECTORY, { recursive: true }),
    mkdir(IOS_ASSET_CATALOG_DIRECTORY, { recursive: true }),
  ]);

  await writeFile(
    resolve(IOS_ASSET_CATALOG_DIRECTORY, "Contents.json"),
    `${JSON.stringify({ info: { author: "xcode", version: 1 } }, null, 2)}\n`,
  );

  for (const asset of imported) {
    const imageSetDirectory = resolve(
      IOS_ASSET_CATALOG_DIRECTORY,
      `${asset.assetName}.imageset`,
    );
    await mkdir(imageSetDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        resolve(OUTPUT_DIRECTORY, asset.vectorFilename),
        asset.vectorContents,
      ),
      writeFile(
        resolve(OUTPUT_DIRECTORY, asset.rasterFilename),
        asset.rasterContents,
      ),
      writeFile(
        resolve(imageSetDirectory, asset.vectorFilename),
        asset.vectorContents,
      ),
      writeFile(
        resolve(imageSetDirectory, "Contents.json"),
        `${JSON.stringify(
          {
            images: [
              {
                filename: asset.vectorFilename,
                idiom: "universal",
              },
            ],
            info: { author: "xcode", version: 1 },
            properties: {
              "preserves-vector-representation": true,
              "template-rendering-intent": "original",
            },
          },
          null,
          2,
        )}\n`,
      ),
    ]);
  }

  const manifest = {
    formatVersion: 1,
    source: "User-provided Pokémon TCG Vectors archive",
    sourceDirectory:
      sourceDirectory === OUTPUT_DIRECTORY
        ? "Rarities"
        : basename(sourceDirectory),
    sourceLicense: null,
    artworkCount: imported.length,
    assets: Object.fromEntries(
      imported.map((asset) => [
        asset.key,
        {
          labels: asset.labels,
          sourceFile: asset.sourceFile,
          vector: {
            file: asset.vectorFilename,
            sha256: asset.vectorSha256,
            url: `${PUBLIC_ROOT}/${asset.vectorFilename}`,
          },
          raster: {
            file: asset.rasterFilename,
            sha256: asset.rasterSha256,
            width: 128,
            height: 128,
            url: `${PUBLIC_ROOT}/${asset.rasterFilename}`,
          },
        },
      ]),
    ),
  };
  await writeFile(
    resolve(OUTPUT_DIRECTORY, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const seenLabels = new Set();
  const swiftCases = imported.flatMap((asset) =>
    asset.labels
      .map((label) => label.toLowerCase())
      .filter((label) => {
        if (seenLabels.has(label)) return false;
        seenLabels.add(label);
        return true;
      })
      .map(
        (label) =>
          `        case ${swiftString(label.toLowerCase())}:\n` +
          `            return PokemonRarityArtworkAsset(\n` +
          `                assetName: ${swiftString(asset.assetName)},\n` +
          `                fallbackFilename: ${swiftString(asset.rasterFilename)}\n` +
          `            )`,
      ),
  );
  const swift =
    `// Generated by tools/pokemon/import-rarity-vectors.mjs. Do not edit.\n` +
    `import Foundation\n\n` +
    `struct PokemonRarityArtworkAsset: Equatable {\n` +
    `    let assetName: String\n` +
    `    let fallbackFilename: String\n` +
    `}\n\n` +
    `enum PokemonRarityArtworkCatalog {\n` +
    `    static func artwork(for rarity: String) -> PokemonRarityArtworkAsset? {\n` +
    `        switch rarity.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {\n` +
    `${swiftCases.join("\n")}\n` +
    `        default:\n` +
    `            return nil\n` +
    `        }\n` +
    `    }\n` +
    `}\n`;
  await writeFile(GENERATED_SWIFT, swift);

  console.log(
    JSON.stringify(
      {
        sourceDirectory,
        artworkCount: imported.length,
        vectorCount: imported.length,
        rasterCount: imported.length,
        outputDirectory: OUTPUT_DIRECTORY,
        iosAssetCatalogDirectory: IOS_ASSET_CATALOG_DIRECTORY,
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
