/**
 * Offline card catalogs (`tcger-catalog`), on Dexie.
 *
 * Stage 3 of `docs/data-layer-dexie-convex-plan.md` §4, and the stage §5 R3
 * calls the highest-risk one in the whole plan: an existing visitor's
 * `tcger-catalog` holds up to ~20 MB of downloaded Magic data (~106k cards).
 * If the schema declared here does not describe *exactly* what is already in
 * their browser, Dexie restructures a populated database and every one of them
 * silently re-downloads.
 *
 * ## What is on disk today, and why it is not expressible in `stores()` alone
 *
 * The released schema — created by this module's previous raw-IndexedDB
 * implementation, reproduced verbatim in `ensureCatalogStores()` below — is:
 *
 *   database "tcger-catalog", native version 1
 *     store "packs"  keyPath "tcg"
 *     store "cards"  keyPath ["tcg", "id"]
 *       index "by-tcg"     on "tcg"              (unique: false)
 *       index "by-tcg-set" on ["tcg", "setCode"] (unique: false)
 *
 * Two things about that shape do not survive a naive translation to Dexie:
 *
 * 1. **Dexie's declared version is not the native version.** `dexieOpen()`
 *    opens at `Math.round(db.verno * 10)`, so `version(1)` would ask for native
 *    version **10** and force a `versionchange` upgrade on every existing
 *    install. That upgrade turns out to be structurally empty (see the trace
 *    below), but it is one-way: the native version can never go back down, and
 *    any older bundle still calling `indexedDB.open(name, 1)` — a rolled-back
 *    deploy, a tab holding a service-worker-cached page — would then fail with
 *    a `VersionError`. `version(0.1)` maps to native version 1, which is what
 *    is already there, so no upgrade transaction runs at all.
 *
 * 2. **Dexie derives index names from key paths.** `stores()` has no syntax for
 *    naming an index; a `cards` store created by Dexie gets indexes called
 *    `tcg` and `[tcg+setCode]`, not `by-tcg` and `by-tcg-set`. On an *existing*
 *    database this does not matter — `adjustToExistingIndexNames()` rewrites the
 *    declared names to the installed ones before Dexie diffs the schema, and
 *    every query resolves indexes by key path, not by name. But on a *fresh*
 *    install Dexie would create a database whose index names differ from the
 *    released ones, so an older bundle that later ran against it would throw
 *    `NotFoundError` from `.index("by-tcg")`.
 *
 * So the object stores are still created by hand, once, by
 * `ensureCatalogStores()` — a copy of the released `onupgradeneeded` — and Dexie
 * is only ever pointed at a database that already has the released shape. Every
 * install, old and new, therefore converges on one on-disk schema, and the
 * `version(0.1)` block below is a *description* of it rather than a recipe for
 * building a different one.
 *
 * ## Why the declaration cannot restructure an existing database
 *
 * With `version(0.1)`, `nativeVerToOpen === 1 === CATALOG_DB_VERSION`, so
 * `indexedDB.open` finds the version it asked for and `onupgradeneeded` never
 * fires. Dexie's no-upgrade path then runs `adjustToExistingIndexNames()`
 * (declared `tcg` → installed `by-tcg`, declared `[tcg+setCode]` → installed
 * `by-tcg-set`) followed by `verifyInstalledSchema()`, whose diff compares
 * `src` strings derived from key paths: `"tcg"` vs `"tcg"` and
 * `"[tcg+setCode]"` vs `"[tcg+setCode]"`, with primary keys `"tcg,id"` vs
 * `"tcg,id"`. Nothing to add, nothing to change — so Dexie neither enters its
 * schema-patch mode nor bumps the native version. `deleteRemovedTables()`,
 * the one code path that could drop a populated store, only runs inside an
 * upgrade transaction, which never starts.
 *
 * ## Rules for this file
 *
 *  - **Never edit the released `version(0.1)` block.** Add a new one
 *    (`version(0.2)`, native 2) and leave it alone, exactly as
 *    `src/lib/storage/demo-db.ts` does.
 *  - **Never rename the database, a store, a key path or an index.** A rename
 *    is not a migration; it is a silent ~20 MB re-download (§5 R3, and the
 *    header of `src/lib/storage/keys.ts`).
 *  - Catalogs are still replaced wholesale per game and per pack version, so
 *    there is no row-shape migration story here and none is needed.
 *
 * Bundle note (§5 R6): `dexie` is behind a dynamic `import()` because
 * `use-catalog.ts` reaches this module from non-demo pages, and a static import
 * would pull the wrapper into the authenticated app's main bundle. Nothing here
 * runs at import time, so the module stays safe to evaluate during SSR and
 * static export (§5 R5).
 */

import type { Table } from "dexie";

import {
  CATALOG_CARDS_SET_INDEX as CARDS_SET_INDEX,
  CATALOG_CARDS_STORE as CARDS_STORE,
  CATALOG_CARDS_TCG_INDEX as CARDS_TCG_INDEX,
  CATALOG_DB_NAME as DB_NAME,
  CATALOG_DB_VERSION as DB_VERSION,
  CATALOG_PACKS_STORE as PACKS_STORE,
} from "@/lib/storage/keys";

import type { CatalogTcgCode } from "./catalog-types";

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

/* ------------------------------------------------------------------ */
/*  Schema constants                                                   */
/* ------------------------------------------------------------------ */

/**
 * Dexie's version number for the released schema.
 *
 * Dexie multiplies this by 10 to get the native IndexedDB version, so `0.1`
 * means native version 1 — the value `CATALOG_DB_VERSION` records and the value
 * every existing `tcger-catalog` is already at. `0.1` is also Dexie's minimum
 * legal version (`Dexie.prototype.version` rejects anything below it), which is
 * precisely because it exists to describe a database somebody else created at
 * native version 1.
 *
 * A released block is immutable, so this stays a literal rather than
 * `DB_VERSION / 10`: bumping `CATALOG_DB_VERSION` must mean *adding* a
 * `version(0.2)` block, never silently re-pointing this one.
 */
const DEXIE_SCHEMA_VERSION = 0.1;

/**
 * Key-path aliases Dexie uses to address the stores' keys. These are *not*
 * index names — the released names live in `keys.ts` as
 * {@link CARDS_TCG_INDEX} / {@link CARDS_SET_INDEX} and are applied by
 * `ensureCatalogStores()`. Dexie resolves both `where()` clauses and its schema
 * diff by key path, so these are what the query layer must speak.
 */
const CARDS_PRIMARY_KEY = "[tcg+id]";
const CARDS_TCG_KEY = "tcg";
const CARDS_SET_KEY = "[tcg+setCode]";

/**
 * Upper bound for one game's slice of the compound `["tcg", "id"]` primary key.
 *
 * An empty array sorts above every string in IndexedDB's key ordering, so
 * `["magic", []]` is greater than `["magic", <any card id>]` and below
 * `["magicx", …]`. This is the exact bound the raw implementation used for its
 * range delete, kept so "delete this game's cards" covers the same keys it
 * always did.
 */
const HIGHEST_CARD_ID: unknown[] = [];

/**
 * How long an open may take before this module gives up on it for the current
 * attempt.
 *
 * IndexedDB can wedge without ever firing an event (blocked upgrades, some
 * embedded webviews). `useCatalog`'s `refresh()` awaits this module before it
 * clears `isLoading`, so an unbounded open leaves the catalog screen spinning
 * forever instead of reporting that storage is unavailable — the same reasoning
 * as `HYDRATE_TIMEOUT_MS` in `src/lib/storage/demo-db.ts`.
 */
const OPEN_TIMEOUT_MS = 5_000;

/* ------------------------------------------------------------------ */
/*  Diagnostics                                                        */
/* ------------------------------------------------------------------ */

const warned = new Set<string>();

/**
 * Storage problems are diagnostics, not events — the same broken browser hits
 * the same path on every read. One line per distinct cause, per session.
 *
 * Silent on the server: there is nothing wrong with a prerender having no
 * IndexedDB, and a build log full of storage warnings trains people to ignore
 * the one that matters (§5 R5, and the same stance as `demo-db.ts`).
 */
function warnOnce(tag: string, message: string, error?: unknown): void {
  if (typeof window === "undefined") return;
  if (warned.has(tag)) return;
  warned.add(tag);
  if (error === undefined) console.warn(`[tcger-catalog] ${message}`);
  else console.warn(`[tcger-catalog] ${message}`, error);
}

/* ------------------------------------------------------------------ */
/*  Schema bootstrap (raw IndexedDB, released shape)                   */
/* ------------------------------------------------------------------ */

function ensureIndexedDb(): IDBFactory {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is unavailable in this browser.");
  }
  return indexedDB;
}

/**
 * Create the released object stores if — and only if — the database does not
 * have them yet, using the exact `createObjectStore`/`createIndex` calls the
 * raw implementation shipped with.
 *
 * This is the one place that names indexes, because Dexie's `stores()` syntax
 * cannot (see the module header). Opening at {@link DB_VERSION} — the version
 * every existing database is already at — means `onupgradeneeded` fires only
 * for a database that does not exist yet, so this can never restructure a
 * populated one.
 *
 * Never rejects. A failure here is not authoritative: Dexie's own open runs
 * next and is the thing that decides whether the catalog is usable, and it
 * produces a far better error than a duplicated one from here would.
 */
function ensureCatalogStores(factory: IDBFactory): Promise<void> {
  return new Promise<void>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch (error) {
      warnOnce(
        "bootstrap-open",
        "Could not open the catalog database to check its schema.",
        error,
      );
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

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
      // Closed unconditionally, even if `finish()` already ran: a connection
      // left open here would block the next `deleteDatabase` — which is how
      // `clearAllLocalData()` resets local storage — for the life of the tab.
      try {
        request.result.close();
      } catch {
        /* closing an already-broken handle is best effort */
      }
      finish();
    };
    request.onerror = () => {
      warnOnce(
        "bootstrap-failed",
        "Could not verify the catalog database schema; continuing anyway.",
        request.error,
      );
      finish();
    };
    request.onblocked = () => {
      // Only reachable if another connection is holding a *lower* version open,
      // which cannot happen while `CATALOG_DB_VERSION` stays at 1. Stop waiting
      // rather than hanging; `onsuccess` still closes the connection if the
      // browser completes the open later.
      warnOnce(
        "bootstrap-blocked",
        "Another tab is holding the catalog database open; continuing anyway.",
      );
      finish();
    };
  });
}

/* ------------------------------------------------------------------ */
/*  The Dexie database                                                 */
/* ------------------------------------------------------------------ */

async function loadCatalogDatabase() {
  const { default: Dexie } = await import("dexie");

  class CatalogDatabase extends Dexie {
    constructor() {
      super(DB_NAME);
      // v0.1 (native IndexedDB version 1) — RELEASED. Do not edit; see the
      // module header for why this describes, rather than creates, the schema.
      this.version(DEXIE_SCHEMA_VERSION).stores({
        [PACKS_STORE]: "tcg",
        [CARDS_STORE]: `${CARDS_PRIMARY_KEY}, ${CARDS_TCG_KEY}, ${CARDS_SET_KEY}`,
      });
    }

    // Accessors rather than declared fields so the tables stay tied to the
    // store names in `keys.ts`. Dexie assigns `db[storeName]` only when the
    // property is not already defined, so these getters win and keep working.
    get packs(): Table<InstalledCatalogPack, CatalogTcgCode> {
      return this.table(PACKS_STORE);
    }

    get cards(): Table<StoredCatalogCard, [CatalogTcgCode, string]> {
      return this.table(CARDS_STORE);
    }
  }

  return CatalogDatabase;
}

type CatalogDatabaseCtor = Awaited<ReturnType<typeof loadCatalogDatabase>>;
type CatalogDatabase = InstanceType<CatalogDatabaseCtor>;

let catalogDatabaseCtorPromise: Promise<CatalogDatabaseCtor> | null = null;

function catalogDatabaseCtor(): Promise<CatalogDatabaseCtor> {
  // Cached so the class — and therefore the schema declaration — is created
  // once per session.
  if (!catalogDatabaseCtorPromise) {
    catalogDatabaseCtorPromise = loadCatalogDatabase().catch(
      (error: unknown) => {
        // A *failure* is not cached: a chunk that failed to load once — flaky
        // network, or a deploy swapping assets out from under an open tab —
        // can succeed on the next attempt.
        catalogDatabaseCtorPromise = null;
        throw error;
      },
    );
  }
  return catalogDatabaseCtorPromise;
}

let databasePromise: Promise<CatalogDatabase> | null = null;

/**
 * Set once the open has timed out, after which this module stops trying for the
 * rest of the session. See {@link openWithinTimeout}.
 */
let openAbandoned: Error | null = null;

/**
 * The cached connection, opened at most once per session.
 *
 * The cache is dropped again on `versionchange` (another tab — or
 * `clearAllLocalData()` in this one — wants to upgrade or delete the database)
 * and on a failed open, so the next caller gets a fresh attempt rather than a
 * permanently poisoned handle. Most open failures *are* transient — a delete in
 * flight, a blocked upgrade — which is why retrying is the default.
 */
function openCatalogDatabase(): Promise<CatalogDatabase> {
  if (openAbandoned) return Promise.reject(openAbandoned);
  if (databasePromise) return databasePromise;

  const promise: Promise<CatalogDatabase> = (async () => {
    const factory = ensureIndexedDb();
    await ensureCatalogStores(factory);

    const CatalogDatabaseCtor = await catalogDatabaseCtor();
    const database = new CatalogDatabaseCtor();

    // Registered before `open()` so no versionchange can slip past it. Dexie's
    // own default subscriber closes the connection too, but leaves auto-reopen
    // on; closing explicitly (Dexie's default for `close()` is
    // `disableAutoOpen: true`) guarantees this instance can never reopen itself
    // mid-delete and block it again. Dropping the cache is what makes a
    // same-tab `deleteDatabase` proceed and the next call reconnect.
    database.on("versionchange", () => {
      if (databasePromise === promise) databasePromise = null;
      closeQuietly(database);
    });

    await openWithinTimeout(database);
    return database;
  })().catch((error: unknown) => {
    if (databasePromise === promise) databasePromise = null;
    throw error instanceof Error
      ? error
      : new Error("Unable to open the catalog database.");
  });

  databasePromise = promise;
  return promise;
}

function closeQuietly(database: CatalogDatabase): void {
  try {
    database.close();
  } catch {
    /* closing an already-broken handle is best effort */
  }
}

/**
 * `db.open()`, bounded by {@link OPEN_TIMEOUT_MS}. A connection that arrives
 * after the deadline is closed rather than kept: the caller has already been
 * told storage is unavailable, and an unused open handle blocks the next
 * upgrade or `deleteDatabase`.
 *
 * A timeout also abandons storage for the rest of the session. An IndexedDB
 * that never answers does not start answering, and retrying would make every
 * later catalog read stall for another {@link OPEN_TIMEOUT_MS} instead of
 * failing instantly — the same call `demo-db.ts` makes when hydration times out.
 */
function openWithinTimeout(database: CatalogDatabase): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      openAbandoned = new Error(
        "The catalog database took too long to open; offline catalogs are unavailable for this session.",
      );
      warnOnce("open-timeout", openAbandoned.message);
      reject(openAbandoned);
    }, OPEN_TIMEOUT_MS);

    void database.open().then(
      () => {
        clearTimeout(timer);
        if (settled) {
          closeQuietly(database);
          return;
        }
        settled = true;
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(error);
      },
    );
  });
}

/* ------------------------------------------------------------------ */
/*  Shared query helpers                                               */
/* ------------------------------------------------------------------ */

/** Every card belonging to one game, addressed through the primary key. */
function gameCards(database: CatalogDatabase, tcg: CatalogTcgCode) {
  return database.cards
    .where(CARDS_PRIMARY_KEY)
    .between([tcg], [tcg, HIGHEST_CARD_ID], true, true);
}

/**
 * Run a read, and treat any storage failure as "nothing is installed".
 *
 * Reads degrade instead of rejecting because there is nothing a caller can do
 * with the failure: `catalog-search.ts` already branches on an absent pack
 * (`if (!installed) return []`), and `useCatalog`'s `refresh()` already folds a
 * rejection into an empty installed list. Resolving with the fallback reaches
 * the same UI state without leaving unhandled rejections in the demo's search
 * path, where nothing catches today.
 *
 * Writes deliberately do *not* use this — see `replaceCatalog`.
 */
async function readCatalog<T>(
  tag: string,
  fallback: T,
  read: (database: CatalogDatabase) => Promise<T>,
): Promise<T> {
  try {
    return await read(await openCatalogDatabase());
  } catch (error) {
    warnOnce(
      `read:${tag}`,
      `Could not read ${tag} from the offline catalog; treating it as not installed.`,
      error,
    );
    return fallback;
  }
}

/**
 * Wrap a write failure so the message `useCatalog` renders names the catalog
 * and the operation, with the underlying `QuotaExceededError` (or whatever it
 * was) still attached as `cause`.
 */
function catalogWriteError(
  action: string,
  tcg: CatalogTcgCode,
  error: unknown,
): Error {
  const detail =
    error instanceof Error && error.message ? `: ${error.message}` : ".";
  return new Error(`Unable to ${action} the ${tcg} catalog${detail}`, {
    cause: error,
  });
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function getInstalledCatalog(
  tcg: CatalogTcgCode,
): Promise<InstalledCatalogPack | undefined> {
  return readCatalog<InstalledCatalogPack | undefined>(
    "the installed catalog",
    undefined,
    (database) => database.packs.get(tcg),
  );
}

export async function getInstalledCatalogs(): Promise<InstalledCatalogPack[]> {
  return readCatalog<InstalledCatalogPack[]>(
    "the installed catalogs",
    [],
    (database) => database.packs.toArray(),
  );
}

export async function getCatalogCards(
  tcg: CatalogTcgCode,
): Promise<CatalogCard[]> {
  return readCatalog<CatalogCard[]>("catalog cards", [], (database) =>
    // Resolves to the installed `by-tcg` index by key path, and reads it with
    // one `IDBIndex.getAll` — the same call the raw implementation made.
    database.cards.where(CARDS_TCG_KEY).equals(tcg).toArray(),
  );
}

export async function getCatalogCardsForSet(
  tcg: CatalogTcgCode,
  setCode: string,
): Promise<CatalogCard[]> {
  return readCatalog<CatalogCard[]>("catalog cards for a set", [], (database) =>
    database.cards.where(CARDS_SET_KEY).equals([tcg, setCode]).toArray(),
  );
}

/**
 * Install a catalog, replacing whatever is stored for that game.
 *
 * One `rw` transaction covers the range delete, every card and the pack row, so
 * the install is all-or-nothing: if it fails part way — quota exhaustion is the
 * realistic case for a ~20 MB pack — Dexie aborts, the delete rolls back with
 * everything else, and the previously installed catalog is still there.
 *
 * Unlike the reads above this **rejects** on failure, and must: its result is
 * the installed pack, so there is no value that could honestly represent "not
 * saved". `downloadCatalog` propagates the rejection to `useCatalog`'s
 * `install`, which is the only thing that tells a visitor their 20 MB download
 * did not land. Swallowing it would leave the UI reporting a successful install
 * of a catalog that is not there.
 */
export async function replaceCatalog(
  pack: CatalogPack,
  metadata: Omit<
    InstalledCatalogPack,
    "tcg" | "version" | "updatedAt" | "installedAt" | "cardCount" | "sets"
  >,
): Promise<InstalledCatalogPack> {
  const installed: InstalledCatalogPack = {
    tcg: pack.tcg,
    version: pack.version,
    updatedAt: pack.updatedAt,
    installedAt: new Date().toISOString(),
    cardCount: pack.cards.length,
    sets: pack.sets,
    ...metadata,
  };
  const rows = pack.cards.map(
    (card) => ({ ...card, tcg: pack.tcg }) satisfies StoredCatalogCard,
  );

  try {
    const database = await openCatalogDatabase();
    await database.transaction(
      "rw",
      database.cards,
      database.packs,
      async () => {
        await gameCards(database, pack.tcg).delete();
        await database.cards.bulkPut(rows);
        await database.packs.put(installed);
      },
    );
  } catch (error) {
    throw catalogWriteError("install", pack.tcg, error);
  }

  return installed;
}

/**
 * Uninstall a catalog. Rejects on failure for the same reason
 * {@link replaceCatalog} does: `useCatalog`'s `remove` surfaces the message,
 * and a silent no-op would leave a catalog the visitor believes they deleted.
 */
export async function removeCatalog(tcg: CatalogTcgCode): Promise<void> {
  try {
    const database = await openCatalogDatabase();
    await database.transaction(
      "rw",
      database.cards,
      database.packs,
      async () => {
        await database.packs.delete(tcg);
        await gameCards(database, tcg).delete();
      },
    );
  } catch (error) {
    throw catalogWriteError("remove", tcg, error);
  }
}
