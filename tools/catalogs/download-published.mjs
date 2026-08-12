import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_BASE_URL = "https://assets.tcger.ahmadjalil.com/catalogs";

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.CATALOG_BASE_URL?.trim() || DEFAULT_BASE_URL,
    output: resolve(REPO_ROOT, "data/catalog"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--base-url" && value) {
      options.baseUrl = value;
      index += 1;
    } else if (argument === "--output" && value) {
      options.output = resolve(process.cwd(), value);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }

  options.baseUrl = options.baseUrl.replace(/\/+$/, "");
  return options;
}

function outputPath(directory, filename) {
  if (
    typeof filename !== "string" ||
    !filename ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename === "." ||
    filename === ".."
  ) {
    throw new Error(`Unsafe catalog filename: ${String(filename)}`);
  }

  const path = resolve(directory, filename);
  if (!path.startsWith(`${resolve(directory)}${sep}`)) {
    throw new Error(`Catalog file escaped its output directory: ${filename}`);
  }
  return path;
}

async function download(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "TCGer-catalog-downloader/1.0" },
  });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function validateManifest(manifest) {
  if (
    manifest?.formatVersion !== 1 ||
    typeof manifest.generatedAt !== "string" ||
    !manifest.games ||
    typeof manifest.games !== "object" ||
    Array.isArray(manifest.games)
  ) {
    throw new Error("Catalog manifest is missing or uses an unsupported format");
  }
}

function validatePack(entry, contents) {
  if (
    !entry ||
    typeof entry.file !== "string" ||
    typeof entry.bytes !== "number" ||
    typeof entry.sha256 !== "string"
  ) {
    throw new Error("Catalog manifest contains an invalid game entry");
  }

  if (contents.byteLength !== entry.bytes) {
    throw new Error(
      `${entry.file} has ${contents.byteLength} bytes; expected ${entry.bytes}`,
    );
  }

  const sha256 = createHash("sha256").update(contents).digest("hex");
  if (sha256 !== entry.sha256) {
    throw new Error(`${entry.file} failed SHA-256 validation`);
  }
}

async function writeAtomically(path, contents) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents);
  await rename(temporaryPath, path);
}

async function main() {
  const { baseUrl, output } = parseArgs(process.argv.slice(2));
  const manifestContents = await download(`${baseUrl}/manifest.json`);
  const manifest = JSON.parse(manifestContents.toString("utf8"));
  validateManifest(manifest);
  await mkdir(output, { recursive: true });

  for (const [game, entry] of Object.entries(manifest.games).sort()) {
    const path = outputPath(output, entry?.file);
    const contents = await download(
      `${baseUrl}/${encodeURIComponent(entry.file)}`,
    );
    validatePack(entry, contents);
    await writeAtomically(path, contents);
    console.log(`Downloaded ${game}: ${entry.file}`);
  }

  // Write the manifest last so readers never observe references to partial packs.
  await writeAtomically(outputPath(output, "manifest.json"), manifestContents);
  console.log(`Downloaded catalog manifest to ${output}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
