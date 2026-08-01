import {
  type CatalogCard,
  type CatalogPack,
  type CatalogSet,
  getInstalledCatalog,
  removeCatalog as removeCatalogFromDatabase,
  replaceCatalog,
} from "./catalog-db";
import { invalidateCatalogSearchIndex } from "./catalog-search";
import { CATALOG_GAMES, type CatalogTcgCode } from "./catalog-types";
import { catalogAssetUrl } from "./catalog-assets";

export interface CatalogManifestGame {
  version: number;
  cardCount: number;
  setCount: number;
  bytes: number;
  sha256: string;
  file: string;
}

export interface CatalogManifest {
  formatVersion: 1;
  generatedAt: string;
  games: Partial<Record<CatalogTcgCode, CatalogManifestGame>>;
}

export type CatalogDownloadPhase = "downloading" | "saving";

export interface CatalogDownloadProgress {
  phase: CatalogDownloadPhase;
  loadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}

export type CatalogProgressCallback = (
  progress: CatalogDownloadProgress,
) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === "number";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || isStringArray(value);
}

function parseManifestGame(value: unknown): CatalogManifestGame | undefined {
  if (
    !isRecord(value) ||
    typeof value.version !== "number" ||
    typeof value.cardCount !== "number" ||
    typeof value.setCount !== "number" ||
    typeof value.bytes !== "number" ||
    !isString(value.sha256) ||
    !isString(value.file) ||
    !value.file ||
    value.file.includes("/") ||
    value.file.includes("\\")
  ) {
    return undefined;
  }

  return {
    version: value.version,
    cardCount: value.cardCount,
    setCount: value.setCount,
    bytes: value.bytes,
    sha256: value.sha256,
    file: value.file,
  };
}

function parseCatalogManifest(value: unknown): CatalogManifest {
  if (
    !isRecord(value) ||
    value.formatVersion !== 1 ||
    !isString(value.generatedAt) ||
    !isRecord(value.games)
  ) {
    throw new Error("The catalog manifest has an unsupported format.");
  }

  const games: Partial<Record<CatalogTcgCode, CatalogManifestGame>> = {};
  for (const tcg of CATALOG_GAMES) {
    const entry = parseManifestGame(value.games[tcg]);
    if (entry) games[tcg] = entry;
  }

  return {
    formatVersion: 1,
    generatedAt: value.generatedAt,
    games,
  };
}

function isCatalogSet(value: unknown): value is CatalogSet {
  return (
    isRecord(value) &&
    isString(value.code) &&
    isString(value.name) &&
    isOptionalString(value.serie) &&
    isOptionalString(value.releasedAt) &&
    isOptionalNumber(value.count)
  );
}

function isCatalogCard(value: unknown): value is CatalogCard {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isOptionalString(value.setCode) &&
    isOptionalString(value.collectorNumber) &&
    isOptionalString(value.rarity) &&
    isOptionalString(value.type) &&
    isOptionalStringArray(value.types) &&
    isOptionalNumber(value.hp) &&
    isOptionalString(value.manaCost) &&
    isOptionalStringArray(value.colors) &&
    isOptionalString(value.race) &&
    isOptionalNumber(value.atk) &&
    isOptionalNumber(value.def) &&
    isOptionalNumber(value.level) &&
    isOptionalNumber(value.konamiId)
  );
}

function parseCatalogPack(
  value: unknown,
  expectedTcg: CatalogTcgCode,
): CatalogPack {
  if (
    !isRecord(value) ||
    value.formatVersion !== 1 ||
    value.tcg !== expectedTcg ||
    typeof value.version !== "number" ||
    !isString(value.updatedAt) ||
    !Array.isArray(value.sets) ||
    !value.sets.every(isCatalogSet) ||
    !Array.isArray(value.cards) ||
    !value.cards.every(isCatalogCard)
  ) {
    throw new Error(`The ${expectedTcg} catalog pack is invalid.`);
  }

  return {
    formatVersion: 1,
    tcg: expectedTcg,
    version: value.version,
    updatedAt: value.updatedAt,
    sets: value.sets,
    cards: value.cards,
  };
}

function progressValue(
  phase: CatalogDownloadPhase,
  loadedBytes: number,
  totalBytes: number | null,
): CatalogDownloadProgress {
  return {
    phase,
    loadedBytes,
    totalBytes,
    percent:
      totalBytes && totalBytes > 0
        ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100))
        : null,
  };
}

async function sha256Hex(value: string): Promise<string | undefined> {
  if (typeof crypto === "undefined" || !crypto.subtle) return undefined;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function readResponseWithProgress(
  response: Response,
  fallbackBytes: number,
  onProgress?: CatalogProgressCallback,
): Promise<string> {
  const contentLength = Number(response.headers.get("Content-Length"));
  const isEncoded = Boolean(response.headers.get("Content-Encoding"));
  const totalBytes =
    !isEncoded && Number.isFinite(contentLength) && contentLength > 0
      ? contentLength
      : fallbackBytes > 0
        ? fallbackBytes
        : null;

  if (!response.body) {
    const text = await response.text();
    onProgress?.(
      progressValue("downloading", totalBytes ?? text.length, totalBytes),
    );
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let loadedBytes = 0;
  const textParts: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    loadedBytes += value.byteLength;
    textParts.push(decoder.decode(value, { stream: true }));
    onProgress?.(progressValue("downloading", loadedBytes, totalBytes));
  }
  textParts.push(decoder.decode());
  onProgress?.(progressValue("downloading", loadedBytes, totalBytes));
  return textParts.join("");
}

export async function fetchCatalogManifest(): Promise<CatalogManifest> {
  const response = await fetch(catalogAssetUrl("manifest.json"), {
    cache: "no-cache",
  });
  if (!response.ok) {
    throw new Error(
      `Unable to load the catalog manifest (${response.status}).`,
    );
  }
  const value: unknown = await response.json();
  return parseCatalogManifest(value);
}

export async function isCatalogInstalled(
  tcg: CatalogTcgCode,
): Promise<boolean> {
  try {
    return Boolean(await getInstalledCatalog(tcg));
  } catch {
    return false;
  }
}

export async function downloadCatalog(
  tcg: CatalogTcgCode,
  onProgress?: CatalogProgressCallback,
): Promise<void> {
  const manifest = await fetchCatalogManifest();
  const entry = manifest.games[tcg];
  if (!entry) {
    throw new Error(`No ${tcg} catalog is published.`);
  }

  const response = await fetch(catalogAssetUrl(entry.file), {
    cache: "force-cache",
  });
  if (!response.ok) {
    throw new Error(
      `Unable to download the ${tcg} catalog (${response.status}).`,
    );
  }

  const text = await readResponseWithProgress(
    response,
    entry.bytes,
    onProgress,
  );
  const sha256 = await sha256Hex(text);
  if (sha256 && sha256 !== entry.sha256) {
    throw new Error(`The ${tcg} catalog failed its integrity check.`);
  }
  const value: unknown = JSON.parse(text);
  const pack = parseCatalogPack(value, tcg);
  if (pack.version !== entry.version) {
    throw new Error(
      `The ${tcg} catalog version does not match its manifest entry.`,
    );
  }

  onProgress?.(progressValue("saving", entry.bytes, entry.bytes));
  await replaceCatalog(pack, {
    bytes: entry.bytes,
    sha256: entry.sha256,
    file: entry.file,
  });
  invalidateCatalogSearchIndex(tcg);
}

export async function removeCatalog(tcg: CatalogTcgCode): Promise<void> {
  const installed = await getInstalledCatalog(tcg);
  await removeCatalogFromDatabase(tcg);
  invalidateCatalogSearchIndex(tcg);

  if (typeof caches === "undefined") return;
  try {
    const filenames = new Set(
      [installed?.file, `${tcg}.pack.json`].filter((value): value is string =>
        Boolean(value),
      ),
    );
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.endsWith("-catalog"))
        .map(async (name) => {
          const cache = await caches.open(name);
          const requests = await cache.keys();
          await Promise.all(
            requests
              .filter((request) => {
                const pathname = new URL(request.url).pathname;
                return Array.from(filenames).some((file) =>
                  pathname.endsWith(`/catalog/${file}`),
                );
              })
              .map((request) => cache.delete(request)),
          );
        }),
    );
  } catch {
    // IndexedDB is authoritative; stale HTTP cache entries are harmless.
  }
}
