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
import { isDemoMode } from "@/lib/demo-mode";
import {
  gamePackageManifestSchema,
  type GamePackageManifest,
} from "@tcg/api-types";

export interface CatalogManifestGame {
  version: number;
  cardCount: number;
  setCount: number;
  bytes: number;
  compressedBytes?: number;
  sha256: string;
  file: string;
  packageFile?: string;
  sealedProducts?: SealedCatalogManifestEntry;
}

export interface OfficialGamePackage {
  tcg: CatalogTcgCode;
  manifestUrl: string;
  manifest: GamePackageManifest;
}

export interface SealedCatalogManifestEntry {
  version: number;
  productCount: number;
  bytes: number;
  compressedBytes?: number;
  sha256: string;
  file: string;
}

export interface SealedCatalogProduct {
  id: string;
  tcg: CatalogTcgCode;
  name: string;
  productType: string;
  setCode?: string;
  cardsPerPack?: number;
  packsPerBox?: number;
  releaseDate?: string;
  imageUrl?: string;
  marketPrice?: number;
  upc?: string;
  contentMode?: "fixed" | "pool";
  contentCount?: number;
  contents?: Array<{
    externalId?: string;
    name: string;
    quantity?: number;
    setCode?: string;
    rarity?: string;
    imageUrl?: string;
  }>;
  contentSource?: string;
  contentUpdatedAt?: string;
}

interface SealedCatalogPack {
  formatVersion: 1;
  tcg: CatalogTcgCode;
  version: number;
  updatedAt: string;
  products: SealedCatalogProduct[];
}

export interface InstalledSealedCatalog {
  tcg: CatalogTcgCode;
  version: number;
  productCount: number;
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

function isOptionalDexEntries(
  value: unknown,
): value is Array<{ number: number; name: string }> | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (entry) =>
          isRecord(entry) &&
          typeof entry.number === "number" &&
          Number.isInteger(entry.number) &&
          entry.number > 0 &&
          isString(entry.name),
      ))
  );
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
    compressedBytes: isOptionalNumber(value.compressedBytes)
      ? value.compressedBytes
      : undefined,
    sha256: value.sha256,
    file: value.file,
    packageFile:
      isOptionalString(value.packageFile) &&
      value.packageFile &&
      !value.packageFile.includes("/") &&
      !value.packageFile.includes("\\")
        ? value.packageFile
        : undefined,
    sealedProducts: parseSealedManifestEntry(value.sealedProducts),
  };
}

function parseSealedManifestEntry(
  value: unknown,
): SealedCatalogManifestEntry | undefined {
  if (
    !isRecord(value) ||
    typeof value.version !== "number" ||
    typeof value.productCount !== "number" ||
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
    productCount: value.productCount,
    bytes: value.bytes,
    compressedBytes: isOptionalNumber(value.compressedBytes)
      ? value.compressedBytes
      : undefined,
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
  for (const [gameId, candidate] of Object.entries(value.games)) {
    if (!isCatalogGameCode(gameId)) continue;
    const tcg: CatalogTcgCode = gameId;
    const entry = parseManifestGame(candidate);
    if (entry) games[tcg] = entry;
  }

  return {
    formatVersion: 1,
    generatedAt: value.generatedAt,
    games,
  };
}

export async function fetchOfficialGamePackages(
  catalogManifest: CatalogManifest,
): Promise<OfficialGamePackage[]> {
  const packages = await Promise.all(
    Object.entries(catalogManifest.games).map(async ([gameId, entry]) => {
      if (!entry?.packageFile || !isCatalogGameCode(gameId)) return undefined;
      const tcg: CatalogTcgCode = gameId;
      const manifestUrl = catalogAssetUrl(entry.packageFile);
      const response = await fetch(manifestUrl, { cache: "no-cache" });
      if (!response.ok) return undefined;
      const parsed = gamePackageManifestSchema.safeParse(await response.json());
      if (!parsed.success) return undefined;
      const manifest = parsed.data;
      if (
        manifest.publisher.id !== "tcger" ||
        manifest.game.id !== tcg ||
        manifest.catalog.cardCount !== entry.cardCount ||
        manifest.catalog.asset.sha256.toLowerCase() !==
          entry.sha256.toLowerCase()
      ) {
        return undefined;
      }
      return { tcg, manifestUrl, manifest } satisfies OfficialGamePackage;
    }),
  );
  return packages
    .filter((value): value is OfficialGamePackage => value !== undefined)
    .sort((left, right) =>
      left.manifest.game.name.localeCompare(right.manifest.game.name),
    );
}

function isCatalogSet(value: unknown): value is CatalogSet {
  return (
    isRecord(value) &&
    isString(value.code) &&
    isString(value.name) &&
    isOptionalString(value.serie) &&
    isOptionalString(value.releasedAt) &&
    isOptionalNumber(value.count) &&
    isOptionalString(value.iconUrl) &&
    isOptionalString(value.iconFallbackUrl) &&
    isOptionalString(value.logoUrl)
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
    isOptionalString(value.category) &&
    isOptionalDexEntries(value.dexEntries) &&
    isOptionalStringArray(value.types) &&
    isOptionalNumber(value.hp) &&
    isOptionalString(value.manaCost) &&
    isOptionalStringArray(value.colors) &&
    isOptionalString(value.race) &&
    isOptionalNumber(value.atk) &&
    isOptionalNumber(value.def) &&
    isOptionalNumber(value.level) &&
    isOptionalNumber(value.konamiId) &&
    isOptionalString(value.imageUrl) &&
    isOptionalString(value.imageUrlSmall)
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

function isSealedProductContent(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOptionalString(value.externalId) &&
    isString(value.name) &&
    isOptionalNumber(value.quantity) &&
    isOptionalString(value.setCode) &&
    isOptionalString(value.rarity) &&
    isOptionalString(value.imageUrl)
  );
}

function isSealedCatalogProduct(value: unknown): value is SealedCatalogProduct {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.tcg) &&
    isCatalogGameCode(value.tcg) &&
    isString(value.name) &&
    isString(value.productType) &&
    isOptionalString(value.setCode) &&
    isOptionalNumber(value.cardsPerPack) &&
    isOptionalNumber(value.packsPerBox) &&
    isOptionalString(value.releaseDate) &&
    isOptionalString(value.imageUrl) &&
    isOptionalNumber(value.marketPrice) &&
    isOptionalString(value.upc) &&
    (value.contentMode === undefined ||
      value.contentMode === "fixed" ||
      value.contentMode === "pool") &&
    isOptionalNumber(value.contentCount) &&
    (value.contents === undefined ||
      (Array.isArray(value.contents) &&
        value.contents.every(isSealedProductContent))) &&
    isOptionalString(value.contentSource) &&
    isOptionalString(value.contentUpdatedAt)
  );
}

function isCatalogGameCode(value: string): value is CatalogTcgCode {
  return CATALOG_GAMES.includes(value as CatalogTcgCode);
}

function parseSealedCatalogPack(
  value: unknown,
  expectedTcg: CatalogTcgCode,
): SealedCatalogPack {
  if (
    !isRecord(value) ||
    value.formatVersion !== 1 ||
    value.tcg !== expectedTcg ||
    typeof value.version !== "number" ||
    !isString(value.updatedAt) ||
    !Array.isArray(value.products) ||
    !value.products.every(isSealedCatalogProduct)
  ) {
    throw new Error(`The ${expectedTcg} sealed-product catalog is invalid.`);
  }
  return {
    formatVersion: 1,
    tcg: expectedTcg,
    version: value.version,
    updatedAt: value.updatedAt,
    products: value.products,
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

/**
 * Returned when no manifest is published for this deployment: an empty games
 * map, so every game resolves to "unavailable" instead of an error. Absence is
 * a resolved value; a network, HTTP or parse failure still rejects.
 */
const ABSENT_MANIFEST: CatalogManifest = {
  formatVersion: 1,
  generatedAt: "",
  games: {},
};

/** True for the manifest returned when nothing is published (see above). */
export function isCatalogManifestAbsent(manifest: CatalogManifest): boolean {
  return manifest === ABSENT_MANIFEST;
}

function isDemoExperience(): boolean {
  if (typeof window === "undefined") return false;
  return (
    isDemoMode() ||
    window.location.pathname === "/demo" ||
    window.location.pathname.startsWith("/demo/")
  );
}

const CONFIGURED_CATALOG_ORIGIN = process.env.NEXT_PUBLIC_CATALOG_BASE_URL;

/**
 * The generated catalog packs are never bundled with the app itself, so in the
 * demo — which ships without a backend — asking for a same-origin manifest only
 * logs a 404 on every page load. The deployed demo points
 * `NEXT_PUBLIC_CATALOG_BASE_URL` at the asset origin, where the manifest does
 * exist, and that request still goes out so offline catalogs stay installable.
 */
function shouldSkipManifestFetch(): boolean {
  return !CONFIGURED_CATALOG_ORIGIN?.trim() && isDemoExperience();
}

export async function fetchCatalogManifest(): Promise<CatalogManifest> {
  if (shouldSkipManifestFetch()) return ABSENT_MANIFEST;

  const response = await fetch(catalogAssetUrl("manifest.json"), {
    cache: "no-cache",
  });
  if (response.status === 404) {
    // Nothing published here — not a failure worth surfacing.
    return ABSENT_MANIFEST;
  }
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

const SEALED_CATALOG_CACHE = "tcger-sealed-catalog";
const SEALED_CATALOG_INSTALL_PREFIX = "tcger.catalog.sealed.installed.";
export const SEALED_PRODUCTS_ENABLED_KEY = "tcger.sealedProducts.enabled";
export const SEALED_PRODUCTS_PREFERENCE_EVENT =
  "tcger:sealed-products-preference-changed";

function sealedInstallKey(tcg: CatalogTcgCode): string {
  return `${SEALED_CATALOG_INSTALL_PREFIX}${tcg}`;
}

export function areSealedProductsEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(SEALED_PRODUCTS_ENABLED_KEY) !== "false";
}

export function setSealedProductsEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SEALED_PRODUCTS_ENABLED_KEY, String(enabled));
  window.dispatchEvent(new Event(SEALED_PRODUCTS_PREFERENCE_EVENT));
}

function installedSealedCatalog(
  tcg: CatalogTcgCode,
): InstalledSealedCatalog | undefined {
  if (typeof localStorage === "undefined") return undefined;
  const value = localStorage.getItem(sealedInstallKey(tcg));
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      parsed.tcg !== tcg ||
      typeof parsed.version !== "number" ||
      typeof parsed.productCount !== "number" ||
      typeof parsed.bytes !== "number" ||
      !isString(parsed.sha256) ||
      !isString(parsed.file)
    ) {
      return undefined;
    }
    return parsed as unknown as InstalledSealedCatalog;
  } catch {
    return undefined;
  }
}

export async function getInstalledSealedCatalogs(): Promise<
  InstalledSealedCatalog[]
> {
  return CATALOG_GAMES.flatMap((tcg) => installedSealedCatalog(tcg) ?? []);
}

export async function downloadSealedCatalog(
  tcg: CatalogTcgCode,
  onProgress?: CatalogProgressCallback,
): Promise<void> {
  if (typeof caches === "undefined" || typeof localStorage === "undefined") {
    throw new Error(
      "Offline sealed-product catalogs are unavailable in this browser.",
    );
  }
  const manifest = await fetchCatalogManifest();
  const entry = manifest.games[tcg]?.sealedProducts;
  if (!entry) throw new Error(`No ${tcg} sealed-product catalog is published.`);

  const url = catalogAssetUrl(entry.file);
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(
      `Unable to download the ${tcg} sealed-product catalog (${response.status}).`,
    );
  }
  const text = await readResponseWithProgress(
    response,
    entry.bytes,
    onProgress,
  );
  const digest = await sha256Hex(text);
  if (digest && digest !== entry.sha256) {
    throw new Error(
      `The ${tcg} sealed-product catalog failed its integrity check.`,
    );
  }
  const pack = parseSealedCatalogPack(JSON.parse(text) as unknown, tcg);
  if (pack.version !== entry.version) {
    throw new Error(
      `The ${tcg} sealed-product catalog version does not match its manifest entry.`,
    );
  }

  onProgress?.(progressValue("saving", entry.bytes, entry.bytes));
  const cache = await caches.open(SEALED_CATALOG_CACHE);
  await cache.put(
    url,
    new Response(text, {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }),
  );
  const installed: InstalledSealedCatalog = {
    tcg,
    version: entry.version,
    productCount: entry.productCount,
    bytes: entry.bytes,
    sha256: entry.sha256,
    file: entry.file,
  };
  localStorage.setItem(sealedInstallKey(tcg), JSON.stringify(installed));
}

export async function removeSealedCatalog(tcg: CatalogTcgCode): Promise<void> {
  const installed = installedSealedCatalog(tcg);
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(sealedInstallKey(tcg));
  }
  if (!installed || typeof caches === "undefined") return;
  const cache = await caches.open(SEALED_CATALOG_CACHE);
  await cache.delete(catalogAssetUrl(installed.file));
}

export async function removeAllSealedCatalogs(): Promise<void> {
  await Promise.all(CATALOG_GAMES.map(removeSealedCatalog));
}

export async function getInstalledSealedProducts(
  tcg?: CatalogTcgCode,
): Promise<SealedCatalogProduct[]> {
  if (!areSealedProductsEnabled() || typeof caches === "undefined") return [];
  const games = tcg ? [tcg] : CATALOG_GAMES;
  const cache = await caches.open(SEALED_CATALOG_CACHE);
  const products: SealedCatalogProduct[] = [];
  for (const game of games) {
    const installed = installedSealedCatalog(game);
    if (!installed) continue;
    const response = await cache.match(catalogAssetUrl(installed.file));
    if (!response) continue;
    const pack = parseSealedCatalogPack(
      JSON.parse(await response.text()) as unknown,
      game,
    );
    products.push(...pack.products);
  }
  return products;
}
