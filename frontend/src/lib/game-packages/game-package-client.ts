import {
  gamePackageManifestSchema,
  type GamePackageCatalogCard,
  type GamePackageManifest,
} from "@tcg/api-types";

const DB_NAME = "tcger-game-packages";
const DB_VERSION = 1;
const PACKAGES = "packages";
const CARDS = "cards";
const MAX_MANIFEST_BYTES = 1_048_576;

export interface InstalledGamePackage {
  id: string;
  sourceUrl: string;
  installedAt: string;
  manifest: GamePackageManifest;
}

interface StoredCard extends GamePackageCatalogCard {
  gameId: string;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") throw new Error("Game libraries require browser storage");
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(PACKAGES)) db.createObjectStore(PACKAGES, { keyPath: "id" });
    if (!db.objectStoreNames.contains(CARDS)) {
      const cards = db.createObjectStore(CARDS, { keyPath: ["gameId", "id"] });
      cards.createIndex("by-game", "gameId", { unique: false });
    }
  };
  return requestValue(request);
}

function validatedSourceUrl(value: string): URL {
  const url = new URL(value.trim());
  const localDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localDevelopment)) {
    throw new Error("Game package links must use HTTPS");
  }
  if (url.username || url.password) throw new Error("Game package links cannot contain credentials");
  if (url.hash) throw new Error("Game package links cannot contain a fragment");
  return url;
}

function assetUrl(source: URL, value: string): URL {
  const resolved = new URL(value, source);
  return validatedSourceUrl(resolved.href);
}

async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchBytes(url: URL, maximum: number): Promise<Uint8Array> {
  const response = await fetch(url, { cache: "no-store", credentials: "omit", redirect: "error" });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximum) throw new Error("Download is larger than this package type allows");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximum) throw new Error("Download is larger than this package type allows");
  return bytes;
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Downloaded package data is not valid UTF-8 JSON");
  }
}

function parseCatalog(value: unknown, expectedGame: string): GamePackageCatalogCard[] {
  if (!value || typeof value !== "object") throw new Error("Catalog must be a JSON object");
  const catalog = value as Record<string, unknown>;
  if (catalog.formatVersion !== 1 || catalog.tcg !== expectedGame || !Array.isArray(catalog.cards)) {
    throw new Error("Catalog identity does not match the game package");
  }
  const ids = new Set<string>();
  return catalog.cards.map((value, index) => {
    if (!value || typeof value !== "object") throw new Error(`Card ${index + 1} is not an object`);
    const card = value as Record<string, unknown>;
    if (typeof card.id !== "string" || !card.id || typeof card.name !== "string" || !card.name) {
      throw new Error(`Card ${index + 1} needs a non-empty id and name`);
    }
    if (ids.has(card.id)) throw new Error(`Card ${index + 1} repeats id ${card.id}`);
    ids.add(card.id);
    if (card.attributes !== undefined && (!card.attributes || typeof card.attributes !== "object" || Array.isArray(card.attributes))) {
      throw new Error(`Card ${index + 1} has invalid attributes`);
    }
    return card as unknown as GamePackageCatalogCard;
  });
}

export async function installGamePackage(source: string): Promise<InstalledGamePackage> {
  const sourceUrl = validatedSourceUrl(source);
  const manifestBytes = await fetchBytes(sourceUrl, MAX_MANIFEST_BYTES);
  const manifest = gamePackageManifestSchema.parse(decodeJson(manifestBytes));
  const catalogUrl = assetUrl(sourceUrl, manifest.catalog.asset.url);
  const catalogBytes = await fetchBytes(catalogUrl, manifest.catalog.asset.bytes);
  if (catalogBytes.byteLength !== manifest.catalog.asset.bytes) throw new Error("Catalog byte count does not match its manifest");
  if ((await sha256(catalogBytes)) !== manifest.catalog.asset.sha256.toLowerCase()) throw new Error("Catalog checksum does not match its manifest");
  const cards = parseCatalog(decodeJson(catalogBytes), manifest.game.id);
  if (cards.length !== manifest.catalog.cardCount) throw new Error("Catalog card count does not match its manifest");

  const installed: InstalledGamePackage = {
    id: manifest.game.id,
    sourceUrl: sourceUrl.href,
    installedAt: new Date().toISOString(),
    manifest,
  };
  const db = await database();
  try {
    const existingKeys = await requestValue(
      db.transaction(CARDS).objectStore(CARDS).index("by-game").getAllKeys(installed.id),
    );
    const transaction = db.transaction([PACKAGES, CARDS], "readwrite");
    const cardsStore = transaction.objectStore(CARDS);
    existingKeys.forEach((key) => cardsStore.delete(key));
    transaction.objectStore(PACKAGES).put(installed);
    cards.forEach((card) => cardsStore.put({ ...card, gameId: installed.id } satisfies StoredCard));
    await transactionDone(transaction);
  } finally {
    db.close();
  }
  return installed;
}

export async function listInstalledGamePackages(): Promise<InstalledGamePackage[]> {
  const db = await database();
  try {
    const values = await requestValue(db.transaction(PACKAGES).objectStore(PACKAGES).getAll());
    return (values as InstalledGamePackage[]).sort((a, b) => a.manifest.game.name.localeCompare(b.manifest.game.name));
  } finally {
    db.close();
  }
}

export async function gamePackageCards(gameId: string): Promise<GamePackageCatalogCard[]> {
  const db = await database();
  try {
    const cards = await requestValue(db.transaction(CARDS).objectStore(CARDS).index("by-game").getAll(gameId));
    return (cards as StoredCard[]).map(({ gameId: _gameId, ...card }) => card);
  } finally {
    db.close();
  }
}

export async function removeGamePackage(gameId: string): Promise<void> {
  const db = await database();
  try {
    const transaction = db.transaction([PACKAGES, CARDS], "readwrite");
    transaction.objectStore(PACKAGES).delete(gameId);
    const store = transaction.objectStore(CARDS);
    store.index("by-game").openKeyCursor(IDBKeyRange.only(gameId)).onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursor>).result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}
