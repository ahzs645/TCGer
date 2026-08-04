import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const DEFAULT_SOURCE = resolve(
  process.env.HOME ?? "",
  "Downloads/Pokémon TCG Vectors/Rarities",
);
const OUTPUT_DIRECTORY = resolve(REPO_ROOT, "assets/pokemon/rarity-symbols");
const IOS_RESOURCE_DIRECTORY = resolve(
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

async function main() {
  const sourceDirectory = parseSourceArgument(process.argv.slice(2));
  const imported = [];

  for (const entry of ARTWORK) {
    const sourceFilename = `${entry.source}.svg`;
    const vectorContents = cropArchivePadding(
      await readFile(resolve(sourceDirectory, sourceFilename), "utf8"),
    );
    validateSVG(vectorContents, sourceFilename);
    const vectorSha256 = hash(vectorContents);
    const vectorFilename = `${entry.key}.${vectorSha256.slice(0, 16)}.svg`;

    imported.push({
      ...entry,
      sourceFile: sourceFilename,
      vectorContents,
      vectorFilename,
      vectorSha256,
    });
  }

  await Promise.all([
    rm(OUTPUT_DIRECTORY, { recursive: true, force: true }),
    rm(IOS_RESOURCE_DIRECTORY, { recursive: true, force: true }),
  ]);
  await Promise.all([
    mkdir(OUTPUT_DIRECTORY, { recursive: true }),
    mkdir(IOS_RESOURCE_DIRECTORY, { recursive: true }),
  ]);

  for (const asset of imported) {
    await Promise.all([
      writeFile(
        resolve(OUTPUT_DIRECTORY, asset.vectorFilename),
        asset.vectorContents,
      ),
      writeFile(
        resolve(IOS_RESOURCE_DIRECTORY, asset.vectorFilename),
        asset.vectorContents,
      ),
    ]);
  }

  const manifest = {
    formatVersion: 1,
    source: "User-provided Pokémon TCG Vectors archive",
    sourceDirectory: basename(sourceDirectory),
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
          `            return PokemonRarityArtworkAsset(vectorFilename: ${swiftString(asset.vectorFilename)})`,
      ),
  );
  const swift =
    `// Generated by tools/pokemon/import-rarity-vectors.mjs. Do not edit.\n` +
    `import Foundation\n\n` +
    `struct PokemonRarityArtworkAsset: Equatable {\n` +
    `    let vectorFilename: String\n` +
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
        outputDirectory: OUTPUT_DIRECTORY,
        iosResourceDirectory: IOS_RESOURCE_DIRECTORY,
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
