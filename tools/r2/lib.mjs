import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { S3Client } from "@aws-sdk/client-s3";

export const REPO_ROOT = resolve(import.meta.dirname, "../..");

export function dataDirectory(value) {
  return resolve(REPO_ROOT, value ?? "data/catalog");
}

export function parseCliArgs(argv) {
  const values = new Map();
  const flags = new Set();
  const args = [...argv];

  while (args.length > 0) {
    const token = args.shift();
    if (!token?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token ?? ""}`);
    }
    const [key, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      values.set(key, inlineValue);
    } else if (args[0] && !args[0].startsWith("--")) {
      values.set(key, args.shift());
    } else {
      flags.add(key);
    }
  }

  return { values, flags };
}

export function positiveInteger(value, name, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function cleanPrefix(value, fallback) {
  const prefix = (value ?? fallback).replace(/^\/+|\/+$/g, "");
  if (
    !prefix ||
    prefix.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(
      "R2 object prefix must contain safe, non-empty path segments",
    );
  }
  return prefix;
}

export function resolveWithin(root, filename) {
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
  const target = resolve(root, filename);
  if (!target.startsWith(`${resolve(root)}${sep}`)) {
    throw new Error(`Catalog file escaped its data directory: ${filename}`);
  }
  return target;
}

export async function loadCatalogManifest(dataDir) {
  const manifestPath = resolveWithin(dataDir, "manifest.json");
  const contents = await readFile(manifestPath);
  const manifest = JSON.parse(contents.toString("utf8"));
  if (
    manifest?.formatVersion !== 1 ||
    typeof manifest.generatedAt !== "string"
  ) {
    throw new Error(
      "Catalog manifest is missing or uses an unsupported format",
    );
  }
  if (
    !manifest.games ||
    typeof manifest.games !== "object" ||
    Array.isArray(manifest.games)
  ) {
    throw new Error("Catalog manifest has no games map");
  }
  return { manifest, contents, manifestPath };
}

export async function loadVerifiedPack(dataDir, entry) {
  if (
    !entry ||
    typeof entry.file !== "string" ||
    typeof entry.sha256 !== "string" ||
    typeof entry.version !== "number"
  ) {
    throw new Error("Catalog manifest contains an invalid game entry");
  }
  const filePath = resolveWithin(dataDir, entry.file);
  const contents = await readFile(filePath);
  const sha256 = createHash("sha256").update(contents).digest("hex");
  if (sha256 !== entry.sha256) {
    throw new Error(`${entry.file} failed SHA-256 validation`);
  }
  if (contents.byteLength !== entry.bytes) {
    throw new Error(`${entry.file} does not match its manifest byte count`);
  }
  return { contents, filePath };
}

export function createR2Client({ dryRun }) {
  if (dryRun) return undefined;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required",
    );
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export function bucketName(value, dryRun) {
  const bucket = value?.trim() || process.env.R2_BUCKET?.trim();
  if (!bucket && !dryRun) {
    throw new Error("Pass --bucket or set R2_BUCKET");
  }
  return bucket || "tcger-assets";
}

export function isNotFound(error) {
  return (
    error?.name === "NotFound" ||
    error?.name === "NoSuchKey" ||
    error?.$metadata?.httpStatusCode === 404
  );
}

export function isPokemonPocketScannerEntry(entry) {
  const game = String(entry?.game ?? entry?.tcg ?? "").trim().toLowerCase();
  if (game !== "pokemon" && game !== "pokémon") return false;
  const series = entry?.series;
  const fields = [
    entry?.format,
    entry?.gameFormat,
    typeof series === "object" ? series?.id : series,
    typeof series === "object" ? series?.name : undefined,
  ];
  if (fields.some((value) => ["pocket", "tcgp"].includes(String(value ?? "").trim().toLowerCase()))) {
    return true;
  }
  return String(entry?.imageURL ?? entry?.imageUrl ?? "").toLowerCase().includes("/tcgp/");
}

export function assertPhysicalScannerEntries(entries, description = "Scanner metadata") {
  const contaminated = entries.flatMap((entry) => [
    entry,
    ...(Array.isArray(entry.printings)
      ? entry.printings.map((printing) => ({ ...printing, game: printing.game ?? entry.game }))
      : []),
  ]).filter(isPokemonPocketScannerEntry);
  if (contaminated.length > 0) {
    const first = contaminated[0]?.cardId ?? contaminated[0]?.name ?? "unknown";
    throw new Error(
      `${description} contains ${contaminated.length} Pokemon TCG Pocket row(s); first=${first}`,
    );
  }
}

/**
 * Per-game scanner acceptance policy (`tcger-scanner-acceptance-policy-v1`)
 * from `tools/scanner-acceptance-policies.json`, the single source of truth
 * every scanner-manifest publisher embeds as `acceptancePolicy`. A game with
 * no entry publishes the conservative `default` profile; `overridePath`
 * substitutes a reviewed policy file for a calibration release.
 */
export async function loadAcceptancePolicy(game, overridePath = null) {
  const source = overridePath ?? resolve(REPO_ROOT, "tools/scanner-acceptance-policies.json");
  const document = JSON.parse(await readFile(source, "utf8"));
  const policy = overridePath
    ? document
    : (document.games?.[game] ?? document.default);
  if (!policy || typeof policy !== "object") {
    throw new Error(`No acceptance policy for ${game}`);
  }
  const schema = policy.schema ?? document.schema ?? "tcger-scanner-acceptance-policy-v1";
  if (schema !== "tcger-scanner-acceptance-policy-v1") {
    throw new Error(`Unsupported acceptance policy schema ${String(schema)}`);
  }
  const result = { schema, ...policy };
  delete result.calibration;
  for (const key of ["strongAcceptanceScore", "ambiguityMargin", "evidenceFloor"]) {
    if (!(typeof result[key] === "number" && result[key] >= 0 && result[key] <= 1)) {
      throw new Error(`Acceptance policy ${key} must be within [0, 1]`);
    }
  }
  if (result.evidenceFloor > result.strongAcceptanceScore) {
    throw new Error("Acceptance policy evidenceFloor exceeds strongAcceptanceScore");
  }
  if (!["never", "binderPage", "intentionalCaptures"].includes(result.titleGate)) {
    throw new Error("Acceptance policy titleGate is invalid");
  }
  if (!["representative", "family"].includes(result.collectorNumberScope)) {
    throw new Error("Acceptance policy collectorNumberScope is invalid");
  }
  for (const key of ["uniqueTitleRescue", "titleAgreementRescue"]) {
    if (typeof result[key] !== "boolean") throw new Error(`Acceptance policy ${key} must be boolean`);
  }
  result.hubSimilarity ??= 0.9;
  result.hubDistinctNames ??= 3;
  result.hubTopK ??= 5;
  if (!(result.hubSimilarity >= 0 && result.hubSimilarity <= 1)) throw new Error("Acceptance policy hubSimilarity must be within [0, 1]");
  if (!(Number.isInteger(result.hubDistinctNames) && result.hubDistinctNames >= 0)) throw new Error("Acceptance policy hubDistinctNames must be a non-negative integer");
  if (!(Number.isInteger(result.hubTopK) && result.hubTopK >= 1)) throw new Error("Acceptance policy hubTopK must be a positive integer");
  return result;
}

/**
 * Non-card rows that must not sit in a scanner gallery (substitute cards,
 * bio cards, emblems, punchcards, checklists…), as case-insensitive name
 * regexes per game from `tools/scanner-gallery-exclusions.json`. A blank or
 * glare-saturated crop embeds within 0.93 of such rows, above every
 * strong-accept point.
 */
export async function loadGalleryExclusions(game) {
  const document = JSON.parse(await readFile(resolve(REPO_ROOT, "tools/scanner-gallery-exclusions.json"), "utf8"));
  if (document.schema !== "tcger-scanner-gallery-exclusions-v1") {
    throw new Error(`Unsupported gallery exclusions schema ${String(document.schema)}`);
  }
  const patterns = (document.games?.[game]?.namePatterns ?? []).map((pattern) => new RegExp(pattern, "i"));
  return {
    patterns,
    excludes: (name) => patterns.some((pattern) => pattern.test(String(name ?? ""))),
  };
}
