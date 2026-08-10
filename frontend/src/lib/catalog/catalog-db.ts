import type { CatalogTcgCode } from "./catalog-types";

const DB_NAME = "tcger-catalog";
const DB_VERSION = 1;
const PACKS_STORE = "packs";
const CARDS_STORE = "cards";
const CARDS_TCG_INDEX = "by-tcg";
const CARDS_SET_INDEX = "by-tcg-set";

export interface CatalogSet {
  code: string;
  name: string;
  serie?: string;
  releasedAt?: string;
  count?: number;
  standardCount?: number;
  setType?: string;
  releaseYear?: number;
  iconUrl?: string;
  iconFallbackUrl?: string;
  logoUrl?: string;
}

export interface CatalogCard {
  id: string;
  name: string;
  setCode?: string;
  collectorNumber?: string;
  rarity?: string;
  artist?: string;
  archetype?: string;
  classifications?: string[];
  subtypes?: string[];
  variants?: string[];
  source?: string;
  character?: string;
  era?: string;
  specialTrait?: string;
  treatments?: string[];
  collectionTags?: string[];
  type?: string;
  types?: string[];
  hp?: number;
  manaCost?: string;
  colors?: string[];
  race?: string;
  atk?: number;
  def?: number;
  level?: number;
  konamiId?: number;
  imageUrl?: string;
  imageUrlSmall?: string;
  printingKey?: string;
  printingKind?: string;
  sanctionedPlayLegal?: boolean;
  originalPrintingKey?: string;
  pokemonWorldChampionship?: {
    year: number;
    playerName: string;
    deckName?: string;
    originalCollectorNumber?: string;
    printedSignature?: boolean;
    cardBack?: string;
    borderStyle?: string;
    stamp?: string;
    sourceProductId?: string;
    sourceUrl?: string;
  };
}

export interface CatalogPack {
  formatVersion: 1;
  tcg: CatalogTcgCode;
  version: number;
  updatedAt: string;
  sets: CatalogSet[];
  cards: CatalogCard[];
}

export interface InstalledCatalogPack {
  tcg: CatalogTcgCode;
  version: number;
  updatedAt: string;
  installedAt: string;
  cardCount: number;
  bytes: number;
  sha256: string;
  file?: string;
  sets: CatalogSet[];
}

interface StoredCatalogCard extends CatalogCard {
  tcg: CatalogTcgCode;
}

let databasePromise: Promise<IDBDatabase> | null = null;

function ensureIndexedDb(): IDBFactory {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is unavailable in this browser.");
  }
  return indexedDB;
}

function openCatalogDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = ensureIndexedDb().open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PACKS_STORE)) {
        database.createObjectStore(PACKS_STORE, { keyPath: "tcg" });
      }
      if (!database.objectStoreNames.contains(CARDS_STORE)) {
        const cards = database.createObjectStore(CARDS_STORE, {
          keyPath: ["tcg", "id"],
        });
        cards.createIndex(CARDS_TCG_INDEX, "tcg", { unique: false });
        cards.createIndex(CARDS_SET_INDEX, ["tcg", "setCode"], {
          unique: false,
        });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(
        request.error ?? new Error("Unable to open the catalog database."),
      );
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("The catalog database upgrade is blocked."));
    };
  });

  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Catalog database request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Catalog database transaction failed."),
      );
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("Catalog database transaction aborted."),
      );
  });
}

function gameCardKeyRange(tcg: CatalogTcgCode): IDBKeyRange {
  return IDBKeyRange.bound([tcg], [tcg, []]);
}

export async function getInstalledCatalog(
  tcg: CatalogTcgCode,
): Promise<InstalledCatalogPack | undefined> {
  const database = await openCatalogDatabase();
  const transaction = database.transaction(PACKS_STORE, "readonly");
  const request = transaction.objectStore(PACKS_STORE).get(tcg) as IDBRequest<
    InstalledCatalogPack | undefined
  >;
  return requestResult(request);
}

export async function getInstalledCatalogs(): Promise<InstalledCatalogPack[]> {
  const database = await openCatalogDatabase();
  const transaction = database.transaction(PACKS_STORE, "readonly");
  const request = transaction.objectStore(PACKS_STORE).getAll() as IDBRequest<
    InstalledCatalogPack[]
  >;
  return requestResult(request);
}

export async function getCatalogCards(tcg: CatalogTcgCode): Promise<CatalogCard[]> {
  const database = await openCatalogDatabase();
  const transaction = database.transaction(CARDS_STORE, "readonly");
  const request = transaction
    .objectStore(CARDS_STORE)
    .index(CARDS_TCG_INDEX)
    .getAll(IDBKeyRange.only(tcg)) as IDBRequest<StoredCatalogCard[]>;
  return requestResult(request);
}

export async function getCatalogCardsForSet(
  tcg: CatalogTcgCode,
  setCode: string,
): Promise<CatalogCard[]> {
  const database = await openCatalogDatabase();
  const transaction = database.transaction(CARDS_STORE, "readonly");
  const request = transaction
    .objectStore(CARDS_STORE)
    .index(CARDS_SET_INDEX)
    .getAll(IDBKeyRange.only([tcg, setCode])) as IDBRequest<
    StoredCatalogCard[]
  >;
  return requestResult(request);
}

export async function replaceCatalog(
  pack: CatalogPack,
  metadata: Omit<
    InstalledCatalogPack,
    "tcg" | "version" | "updatedAt" | "installedAt" | "cardCount" | "sets"
  >,
): Promise<InstalledCatalogPack> {
  const database = await openCatalogDatabase();
  const transaction = database.transaction(
    [PACKS_STORE, CARDS_STORE],
    "readwrite",
  );
  const cardsStore = transaction.objectStore(CARDS_STORE);
  const installed: InstalledCatalogPack = {
    tcg: pack.tcg,
    version: pack.version,
    updatedAt: pack.updatedAt,
    installedAt: new Date().toISOString(),
    cardCount: pack.cards.length,
    sets: pack.sets,
    ...metadata,
  };

  cardsStore.delete(gameCardKeyRange(pack.tcg));
  for (const card of pack.cards) {
    cardsStore.put({ ...card, tcg: pack.tcg } satisfies StoredCatalogCard);
  }
  transaction.objectStore(PACKS_STORE).put(installed);

  await transactionComplete(transaction);
  return installed;
}

export async function removeCatalog(tcg: CatalogTcgCode): Promise<void> {
  const database = await openCatalogDatabase();
  const transaction = database.transaction(
    [PACKS_STORE, CARDS_STORE],
    "readwrite",
  );
  transaction.objectStore(PACKS_STORE).delete(tcg);
  transaction.objectStore(CARDS_STORE).delete(gameCardKeyRange(tcg));
  await transactionComplete(transaction);
}
