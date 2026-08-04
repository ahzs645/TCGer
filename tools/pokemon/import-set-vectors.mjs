import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const DEFAULT_SOURCE = resolve(
  process.env.HOME ?? "",
  "Downloads/Pokémon TCG Vectors/Set Symbols/svg",
);
const OUTPUT_DIRECTORY = resolve(REPO_ROOT, "assets/pokemon/set-symbols");
const GENERATED_MODULE = resolve(
  REPO_ROOT,
  "backend/src/modules/adapters/pokemon-set-vector-icons.generated.ts",
);
const PUBLIC_ROOT =
  "https://assets.tcger.ahmadjalil.com/catalogs/pokemon-set-symbols";

const MANUAL_SOURCE_FILES = Object.freeze({
  ecard1: "2f Expedition.svg",
  ex1: "3a ex Ruby and Sapphire.svg",
  ex2: "3b ex Sandstorm.svg",
  ex3: "3c ex Dragon.svg",
  ex4: "3d ex Team Magma vs Team Aqua.svg",
  ex5: "3e ex Hidden Legends.svg",
  ex6: "3f ex FireRed and LeafGreen.svg",
  ex7: "3g ex Team Rocket Returns.svg",
  ex8: "3h ex Deoxys.svg",
  ex9: "3i ex Emerald.svg",
  ex10: "3j ex Unseen Forces.svg",
  exu: "3j ex Unseen Forces.svg",
  ex11: "3k ex Delta Species.svg",
  ex12: "3l ex Legend Maker.svg",
  ex13: "3m ex Holon Phantoms.svg",
  ex14: "3n ex Crystal Guardians.svg",
  ex15: "3o ex Dragon Frontiers.svg",
  ex16: "3p ex Power Keepers.svg",
  bw9: "5i Plasma Frost.svg",
  basep: "Pa Blackstar Promos.svg",
  np: "Pa Blackstar Promos.svg",
  dpp: "Pa Blackstar Promos.svg",
  hgssp: "Pa Blackstar Promos.svg",
  bwp: "Pa Blackstar Promos.svg",
  xyp: "Pa Blackstar Promos.svg",
  smp: "Pa Blackstar Promos.svg",
  swshp: "Pa Blackstar Promos.svg",
  pop1: "Pb Pop 1.svg",
  pop2: "Pc Pop 2.svg",
  pop3: "Pd Pop 3.svg",
  pop4: "Pe Pop 4.svg",
  pop5: "Pf Pop 5.svg",
  pop6: "Pg Pop 6.svg",
  pop7: "Ph Pop 7.svg",
  pop8: "Pi Pop 8.svg",
  pop9: "Pj Pop 9.svg",
  "2011bw": "Ma McDonalds 2011.svg",
  "2012bw": "Mb McDonalds 2012.svg",
  "2014xy": "Md McDonalds 2014.svg",
  "2015xy": "Me McDonalds 2015.svg",
  "2016xy": "Mf McDonalds 2016.svg",
  "2017sm": "Mg McDonalds 2017.svg",
  "2018sm": "Mh McDonalds 2018.svg",
  "2019sm": "Mi McDonalds 2019.svg",
  "2021swsh": "Mj McDonalds 2021.svg",
  fut2020: "Pk Futsal.svg",
  "tk-ex-latia": "Ta Latias.svg",
  "tk-ex-latio": "Ta Latios.svg",
  "tk-ex-m": "Tb Minun.svg",
  "tk-ex-p": "Tb Plusle.svg",
  "tk-dp-l": "Tc Lucario.svg",
  "tk-dp-m": "Tc Manaphy.svg",
  "tk-hs-g": "Td Gyarados.svg",
  "tk-hs-r": "Td Raichu.svg",
  "tk-bw-e": "Te Excadrill.svg",
  "tk-bw-z": "Te Zoroark.svg",
  "tk-xy-n": "Tf Noivern.svg",
  "tk-xy-sy": "Tf Sylveon.svg",
  "tk-xy-b": "Tg Bisharp.svg",
  "tk-xy-p": "Tg Pikachu Libre.svg",
  "tk-xy-w": "Tg Wigglytuff.svg",
  "tk-xy-latia": "Th Latias.svg",
  "tk-xy-latio": "Th Latios.svg",
  "tk-xy-su": "Ti Suicune.svg",
  "tk-sm-l": "Tj Lycanroc.svg",
  "tk-sm-r": "Tj Alolan Raichu.svg",
  sma: "7ßd Hidden Fates.svg",
  "swsh4.5sv": "8ßb Shining Fates.svg",
  cel25cc: "8ßc Celebrations.svg",
  "swsh9.5tg": "8i Brilliant Stars.svg",
  "swsh10.5tg": "8j Astral Radiance.svg",
});

function parseSourceArgument(argv) {
  const sourceIndex = argv.indexOf("--source");
  if (sourceIndex === -1) return DEFAULT_SOURCE;
  const value = argv[sourceIndex + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--source requires the SVG directory path");
  }
  return resolve(value);
}

function normalize(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(pokemon|tcg)\b/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function sourceTitle(filename) {
  return basename(filename, extname(filename)).replace(/^\S+\s+/, "");
}

async function currentPokemonSets() {
  const manifest = JSON.parse(
    await readFile(resolve(REPO_ROOT, "data/catalog/manifest.json"), "utf8"),
  );
  const entry = manifest.games?.pokemon;
  if (!entry?.file) {
    throw new Error("Build the catalog packs before importing vector symbols");
  }
  const pack = JSON.parse(
    await readFile(resolve(REPO_ROOT, "data/catalog", entry.file), "utf8"),
  );
  if (!Array.isArray(pack.sets)) {
    throw new Error("The current Pokémon catalog pack has no sets array");
  }
  return pack.sets;
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

async function main() {
  const sourceDirectory = parseSourceArgument(process.argv.slice(2));
  const sourceFiles = (await readdir(sourceDirectory))
    .filter((filename) => extname(filename).toLowerCase() === ".svg")
    .sort();
  const byNormalizedTitle = new Map();
  for (const filename of sourceFiles) {
    const key = normalize(sourceTitle(filename));
    const existing = byNormalizedTitle.get(key) ?? [];
    existing.push(filename);
    byNormalizedTitle.set(key, existing);
  }

  const sets = await currentPokemonSets();
  const mapped = [];
  for (const set of sets) {
    let sourceFile = MANUAL_SOURCE_FILES[set.code];
    if (!sourceFile) {
      const matches = byNormalizedTitle.get(normalize(set.name)) ?? [];
      if (matches.length === 1) sourceFile = matches[0];
    }
    if (!sourceFile) continue;
    if (!sourceFiles.includes(sourceFile)) {
      throw new Error(`Missing mapped source file: ${sourceFile}`);
    }

    const contents = await readFile(
      resolve(sourceDirectory, sourceFile),
      "utf8",
    );
    validateSVG(contents, sourceFile);
    const sha256 = createHash("sha256").update(contents).digest("hex");
    const vectorFilename = `${set.code}.${sha256.slice(0, 16)}.svg`;
    mapped.push({
      setId: set.code,
      setName: set.name,
      sourceFile,
      vectorFilename,
      sha256,
      contents,
    });
  }

  if (mapped.length < 150) {
    throw new Error(
      `Expected at least 150 mapped sets; found ${mapped.length}`,
    );
  }

  await rm(OUTPUT_DIRECTORY, { recursive: true, force: true });
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  for (const asset of mapped) {
    await writeFile(
      resolve(OUTPUT_DIRECTORY, asset.vectorFilename),
      asset.contents,
    );
  }

  const manifest = {
    formatVersion: 1,
    source: "User-provided Pokémon TCG Vectors archive",
    sourceLicense: null,
    setCount: mapped.length,
    assets: Object.fromEntries(
      mapped.map(({ setId, setName, sourceFile, vectorFilename, sha256 }) => [
        setId,
        {
          setName,
          sourceFile,
          vector: { filename: vectorFilename, sha256 },
        },
      ]),
    ),
  };
  await writeFile(
    resolve(OUTPUT_DIRECTORY, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const vectorEntries = mapped
    .map(
      ({ setId, vectorFilename }) =>
        `  ${JSON.stringify(setId)}: ${JSON.stringify(`${PUBLIC_ROOT}/${vectorFilename}`)},`,
    )
    .join("\n");
  const moduleContents =
    `// Generated by tools/pokemon/import-set-vectors.mjs. Do not edit.\n` +
    `export const POKEMON_SET_VECTOR_ICON_URLS: Readonly<Record<string, string>> = Object.freeze({\n${vectorEntries}\n});\n`;
  await writeFile(GENERATED_MODULE, moduleContents);

  console.log(
    JSON.stringify(
      {
        sourceDirectory,
        sourceSVGCount: sourceFiles.length,
        catalogSetCount: sets.length,
        mappedSetCount: mapped.length,
        outputDirectory: OUTPUT_DIRECTORY,
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
