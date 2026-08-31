import {
  duplicateGamePackage,
  gameDefinitionSupportsFeature,
  gamePackageDefinition,
  gamePackageCardAttributes,
  gamePackageId,
  gamePackageManifestSchema,
  gamePackageReleaseRelation,
  POKEDEX_GAME_FEATURE_ID,
  type GamePackageCatalogCard,
  type GamePackageCatalogSet,
  type GamePackageManifest,
} from "@tcg/api-types";

const DB_NAME = "tcger-game-packages";
const DB_VERSION = 2;
const PACKAGES = "packages";
const CARDS = "cards";
const PUBLISHER_KEYS = "publisher-keys";
const MAX_MANIFEST_BYTES = 1_048_576;
export const GAME_PACKAGES_CHANGED_EVENT = "tcger:game-packages-changed";

function dispatchGamePackagesChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(GAME_PACKAGES_CHANGED_EVENT));
  }
}

export interface InstalledGamePackage {
  id: string;
  sourceUrl: string;
  installedAt: string;
  manifest: GamePackageManifest;
  trust?: GamePackageTrust;
}

export interface GamePackageTrust {
  status: "verified" | "unsigned";
  keyId?: string;
  fingerprint?: string;
}

interface StoredPublisherKey {
  id: string;
  publisherId: string;
  keyId: string;
  publicKey: string;
  fingerprint: string;
  trustedAt: string;
}

export interface GamePackageUpdateCheck {
  installedId: string;
  sourceUrl: string;
  manifest: GamePackageManifest;
}

interface StoredCard extends GamePackageCatalogCard {
  gameId: string;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    throw new Error("Game libraries require browser storage");
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(PACKAGES))
      db.createObjectStore(PACKAGES, { keyPath: "id" });
    if (!db.objectStoreNames.contains(CARDS)) {
      const cards = db.createObjectStore(CARDS, { keyPath: ["gameId", "id"] });
      cards.createIndex("by-game", "gameId", { unique: false });
    }
    if (!db.objectStoreNames.contains(PUBLISHER_KEYS))
      db.createObjectStore(PUBLISHER_KEYS, { keyPath: "id" });
  };
  return requestValue(request);
}

function base64Bytes(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function verifyPackagePublisher(
  sourceUrl: URL,
  manifestBytes: Uint8Array,
  manifest: GamePackageManifest,
): Promise<{ trust: GamePackageTrust; key?: StoredPublisherKey }> {
  const signingKey = manifest.publisher.signingKey;
  const signatureMetadata = manifest.signature;
  if (!signingKey || !signatureMetadata)
    return { trust: { status: "unsigned" } };
  if (!manifest.publisher.id)
    throw new Error("Signed packages require a stable publisher id");
  const signatureUrl = assetUrl(sourceUrl, signatureMetadata.url);
  const signature = await fetchBytes(signatureUrl, 512);
  if (signature.byteLength !== 64)
    throw new Error("Package signature must be a 64-byte Ed25519 signature");
  const publicKeyBytes = base64Bytes(signingKey.publicKey);
  if (publicKeyBytes.byteLength !== 32)
    throw new Error("Package signing key must be a 32-byte Ed25519 public key");
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes.slice().buffer,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch {
    throw new Error("This browser cannot verify Ed25519 package signatures");
  }
  if (
    !(await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signature.slice().buffer,
      manifestBytes.slice().buffer,
    ))
  ) {
    throw new Error("Package publisher signature is invalid");
  }
  const fingerprint = await sha256(publicKeyBytes);
  const id = `${manifest.publisher.id}:${signingKey.id}`;
  const db = await database();
  try {
    const pinned = await requestValue<StoredPublisherKey | undefined>(
      db.transaction(PUBLISHER_KEYS).objectStore(PUBLISHER_KEYS).get(id),
    );
    if (pinned && pinned.publicKey !== signingKey.publicKey) {
      throw new Error(
        "The publisher signing key changed; explicit key rotation is required",
      );
    }
  } finally {
    db.close();
  }
  const stored: StoredPublisherKey = {
    id,
    publisherId: manifest.publisher.id,
    keyId: signingKey.id,
    publicKey: signingKey.publicKey,
    fingerprint,
    trustedAt: new Date().toISOString(),
  };
  return {
    trust: { status: "verified", keyId: signingKey.id, fingerprint },
    key: stored,
  };
}

function validatedSourceUrl(value: string): URL {
  const url = new URL(value.trim());
  const localDevelopment =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && localDevelopment)
  ) {
    throw new Error("Game package links must use HTTPS");
  }
  if (url.username || url.password)
    throw new Error("Game package links cannot contain credentials");
  if (url.hash) throw new Error("Game package links cannot contain a fragment");
  return url;
}

function assetUrl(source: URL, value: string): URL {
  const resolved = new URL(value, source);
  return validatedSourceUrl(resolved.href);
}

async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function fetchBytes(url: URL, maximum: number): Promise<Uint8Array> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximum)
    throw new Error("Download is larger than this package type allows");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximum)
    throw new Error("Download is larger than this package type allows");
  return bytes;
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Downloaded package data is not valid UTF-8 JSON");
  }
}

function parseCatalog(
  value: unknown,
  expectedGame: string,
): { cards: GamePackageCatalogCard[]; sets: GamePackageCatalogSet[] } {
  if (!value || typeof value !== "object")
    throw new Error("Catalog must be a JSON object");
  const catalog = value as Record<string, unknown>;
  if (
    catalog.formatVersion !== 1 ||
    catalog.tcg !== expectedGame ||
    !Array.isArray(catalog.cards)
  ) {
    throw new Error("Catalog identity does not match the game package");
  }
  if (catalog.sets !== undefined && !Array.isArray(catalog.sets)) {
    throw new Error("Catalog sets must be an array");
  }
  const sets = (catalog.sets ?? []).map((value, index) => {
    if (!value || typeof value !== "object")
      throw new Error(`Set ${index + 1} is not an object`);
    const set = value as Record<string, unknown>;
    if (
      typeof set.code !== "string" ||
      !set.code ||
      typeof set.name !== "string" ||
      !set.name
    ) {
      throw new Error(`Set ${index + 1} needs a non-empty code and name`);
    }
    return set as unknown as GamePackageCatalogSet;
  });
  const setNames = new Map(sets.map((set) => [set.code, set.name]));
  const ids = new Set<string>();
  const cards = catalog.cards.map((value, index) => {
    if (!value || typeof value !== "object")
      throw new Error(`Card ${index + 1} is not an object`);
    const card = value as Record<string, unknown>;
    if (
      typeof card.id !== "string" ||
      !card.id ||
      typeof card.name !== "string" ||
      !card.name
    ) {
      throw new Error(`Card ${index + 1} needs a non-empty id and name`);
    }
    if (ids.has(card.id))
      throw new Error(`Card ${index + 1} repeats id ${card.id}`);
    ids.add(card.id);
    if (
      card.attributes !== undefined &&
      (!card.attributes ||
        typeof card.attributes !== "object" ||
        Array.isArray(card.attributes))
    ) {
      throw new Error(`Card ${index + 1} has invalid attributes`);
    }
    const parsed = card as unknown as GamePackageCatalogCard;
    const withSet =
      parsed.setName || !parsed.setCode
        ? parsed
        : { ...parsed, setName: setNames.get(parsed.setCode) };
    return { ...withSet, attributes: gamePackageCardAttributes(withSet) };
  });
  return { cards, sets };
}

export async function installGamePackage(
  source: string,
): Promise<InstalledGamePackage> {
  const sourceUrl = validatedSourceUrl(source);
  const manifestBytes = await fetchBytes(sourceUrl, MAX_MANIFEST_BYTES);
  const manifest = gamePackageManifestSchema.parse(decodeJson(manifestBytes));
  const publisherVerification = await verifyPackagePublisher(
    sourceUrl,
    manifestBytes,
    manifest,
  );
  const installedPackages = await listInstalledGamePackages();
  const previous = installedPackages.find(
    (installed) => installed.id === gamePackageId(manifest),
  );
  if (previous) {
    if (
      previous.trust?.status === "verified" &&
      publisherVerification.trust.status !== "verified"
    ) {
      throw new Error(
        "A verified package cannot be replaced by an unsigned update",
      );
    }
    if (
      previous.trust?.status === "verified" &&
      previous.trust.keyId !== publisherVerification.trust.keyId
    ) {
      throw new Error(
        "The publisher signing key changed; explicit key rotation is required",
      );
    }
    const relation = gamePackageReleaseRelation(previous.manifest, manifest);
    if (relation === "same")
      throw new Error("This exact package release is already installed");
    if (relation === "downgrade")
      throw new Error("A newer package release is already installed");
    if (relation === "conflict")
      throw new Error(
        "This package conflicts with the installed release sequence",
      );
  }
  const duplicate = duplicateGamePackage(
    installedPackages.map((installed) => installed.manifest),
    manifest,
  );
  if (duplicate) {
    throw new Error(
      duplicate.kind === "built-in"
        ? "This official TCGer package is available through the Game Store"
        : duplicate.kind === "same-package"
          ? "This exact package version is already installed"
          : "This catalog is already installed under another package name",
    );
  }
  const catalogUrl = assetUrl(sourceUrl, manifest.catalog.asset.url);
  const catalogBytes = await fetchBytes(
    catalogUrl,
    manifest.catalog.asset.bytes,
  );
  if (catalogBytes.byteLength !== manifest.catalog.asset.bytes)
    throw new Error("Catalog byte count does not match its manifest");
  if (
    (await sha256(catalogBytes)) !== manifest.catalog.asset.sha256.toLowerCase()
  )
    throw new Error("Catalog checksum does not match its manifest");
  const catalog = parseCatalog(decodeJson(catalogBytes), manifest.game.id);
  const cards = catalog.cards;
  if (cards.length !== manifest.catalog.cardCount)
    throw new Error("Catalog card count does not match its manifest");
  if (
    manifest.catalog.setCount !== undefined &&
    catalog.sets.length !== manifest.catalog.setCount
  )
    throw new Error("Catalog set count does not match its manifest");
  if (
    gameDefinitionSupportsFeature(
      gamePackageDefinition(manifest),
      POKEDEX_GAME_FEATURE_ID,
    ) &&
    !cards.some((card) => card.dexEntries?.some((entry) => entry.number > 0))
  ) {
    throw new Error("Pokédex support requires normalized dexEntries data");
  }

  const installed: InstalledGamePackage = {
    id: gamePackageId(manifest),
    sourceUrl: manifest.update?.manifestUrl ?? sourceUrl.href,
    installedAt: previous?.installedAt ?? new Date().toISOString(),
    manifest,
    trust: publisherVerification.trust,
  };
  const db = await database();
  try {
    const existingKeys = await requestValue(
      db
        .transaction(CARDS)
        .objectStore(CARDS)
        .index("by-game")
        .getAllKeys(installed.id),
    );
    const transaction = db.transaction(
      [PACKAGES, CARDS, PUBLISHER_KEYS],
      "readwrite",
    );
    const cardsStore = transaction.objectStore(CARDS);
    existingKeys.forEach((key) => cardsStore.delete(key));
    transaction.objectStore(PACKAGES).put(installed);
    if (publisherVerification.key)
      transaction.objectStore(PUBLISHER_KEYS).put(publisherVerification.key);
    cards.forEach((card) =>
      cardsStore.put({ ...card, gameId: installed.id } satisfies StoredCard),
    );
    await transactionDone(transaction);
  } finally {
    db.close();
  }
  dispatchGamePackagesChanged();
  return installed;
}

export async function checkGamePackageUpdate(
  installed: InstalledGamePackage,
): Promise<GamePackageUpdateCheck | undefined> {
  const sourceUrl = validatedSourceUrl(
    installed.manifest.update?.manifestUrl ?? installed.sourceUrl,
  );
  const manifestBytes = await fetchBytes(sourceUrl, MAX_MANIFEST_BYTES);
  const manifest = gamePackageManifestSchema.parse(decodeJson(manifestBytes));
  const publisherVerification = await verifyPackagePublisher(
    sourceUrl,
    manifestBytes,
    manifest,
  );
  if (
    installed.trust?.status === "verified" &&
    publisherVerification.trust.status !== "verified"
  ) {
    throw new Error("A verified package update is no longer signed");
  }
  if (
    installed.trust?.status === "verified" &&
    installed.trust.keyId !== publisherVerification.trust.keyId
  ) {
    throw new Error(
      "The publisher signing key changed; explicit key rotation is required",
    );
  }
  return gamePackageReleaseRelation(installed.manifest, manifest) === "update"
    ? { installedId: installed.id, sourceUrl: sourceUrl.href, manifest }
    : undefined;
}

export async function updateGamePackage(
  installed: InstalledGamePackage,
): Promise<InstalledGamePackage> {
  return installGamePackage(
    installed.manifest.update?.manifestUrl ?? installed.sourceUrl,
  );
}

export async function listInstalledGamePackages(): Promise<
  InstalledGamePackage[]
> {
  const db = await database();
  try {
    const values = await requestValue(
      db.transaction(PACKAGES).objectStore(PACKAGES).getAll(),
    );
    return (values as InstalledGamePackage[]).sort((a, b) =>
      a.manifest.game.name.localeCompare(b.manifest.game.name),
    );
  } finally {
    db.close();
  }
}

export async function gamePackageCards(
  gameId: string,
): Promise<GamePackageCatalogCard[]> {
  const db = await database();
  try {
    const cards = await requestValue(
      db.transaction(CARDS).objectStore(CARDS).index("by-game").getAll(gameId),
    );
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
    store.index("by-game").openKeyCursor(IDBKeyRange.only(gameId)).onsuccess = (
      event,
    ) => {
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
  dispatchGamePackagesChanged();
}
