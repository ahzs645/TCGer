/**
 * Registry of everything TCGer stores in the browser.
 *
 * Stage 0 of `docs/data-layer-dexie-convex-plan.md` §4: one place that names
 * every localStorage key and every IndexedDB database, so that
 *
 *  - a later stage can tell what is already sitting in a returning visitor's
 *    browser before it migrates or deletes any of it (§5 R1), and
 *  - there is a single "reset my local data" escape hatch — `clearAllLocalData`
 *    below — for when a migration goes wrong or storage is corrupt.
 *
 * Rules for this file:
 *
 *  - **Never rename a released key or database.** A rename is not a migration;
 *    it silently orphans the old data (a renamed `tcger-catalog` means a silent
 *    ~20 MB re-download — §5 R3). Add a new constant and migrate explicitly.
 *  - Owners import from here rather than repeating the literal, so a grep for a
 *    key finds every reader and writer.
 *  - Anything added here is deleted by `clearAllLocalData()`. If something must
 *    survive a reset, document it in "Not in the registry" at the bottom
 *    instead of adding it.
 */

/* ------------------------------------------------------------------ */
/*  localStorage — fixed keys                                          */
/* ------------------------------------------------------------------ */

/**
 * `"true"` when demo mode is armed.
 *
 * Owner: `src/lib/demo-mode.ts`. Read on every intercepted `fetch` to decide
 * whether a request to the API base URL is answered locally.
 *
 * Cleared: the fetch interceptor is no longer re-installed on boot, so the app
 * tries to reach a real backend. Under `/demo` the path check in
 * `ensureDemoInterceptor()` re-arms it anyway; anywhere else the visitor is
 * simply back in normal mode. No data loss.
 */
export const DEMO_MODE_STORAGE_KEY = "tcg-demo-mode";

/**
 * zustand-persisted auth slice: `user`, `token`, `isAuthenticated`,
 * `setupRequired` (see the `partialize` in the owner).
 *
 * Owner: `src/stores/auth.ts`.
 *
 * Cleared: the visitor is signed out and the bearer token is gone; the next
 * boot re-runs the `SetupGuard` access check. Recoverable by signing in again.
 * Deliberately stays in localStorage — §5 R7: moving a credential to IndexedDB
 * changes nothing about its security properties and adds an async read to the
 * auth critical path.
 */
export const AUTH_STORE_STORAGE_KEY = "tcg-auth-store";

/**
 * zustand-persisted demo state: profile, preferences, binders (including
 * per-card `cardData` and `copies[]`), wishlists and rules, decks, trades and
 * sealed inventory — the whole store, with no `version` and no `partialize`.
 *
 * Owner: `src/stores/demo-store.ts`.
 *
 * Cleared: **the visitor's entire demo collection is gone** and the store
 * re-seeds from the fixtures in `src/lib/data/demo-portfolio.ts` /
 * `demo-cards.ts`. This is the one key in this file whose loss is not
 * recoverable, which is why §5 R1 requires any migration that reads it to keep
 * the raw string on failure (see `DEMO_STORE_BACKUP_KEY_PREFIX`) rather than
 * drop it.
 */
export const DEMO_STORE_STORAGE_KEY = "tcg-demo-store";

/**
 * `next-themes` theme selection (`"light" | "dark" | "system"`).
 *
 * Owner: `next-themes`, mounted by `src/components/providers/theme-provider.tsx`
 * with the library's default storage key. Not written by TCGer code directly —
 * named here so the inventory is complete and so a reset does not leave one
 * stray key behind.
 *
 * Cleared: the theme falls back to `system`. Cosmetic.
 */
export const THEME_STORAGE_KEY = "theme";

/* ------------------------------------------------------------------ */
/*  localStorage — key families (dynamic suffix)                       */
/* ------------------------------------------------------------------ */

/**
 * Prefix of the per-game, per-catalog-version "don't ask me again" flag:
 * `tcger:catalog-prompt-dismissed:<tcg>:v<version>`.
 *
 * Owner: `src/components/catalog/catalog-download-prompt.tsx`.
 *
 * The version suffix is the point: publishing a new catalog version makes a new
 * key, so a visitor who dismissed the prompt for v3 is asked again at v4.
 * Because the suffix is unbounded, these keys can only be swept by prefix —
 * hence `LOCAL_STORAGE_KEY_PREFIXES` rather than a fixed constant.
 *
 * Cleared: the download prompt reappears for any game whose catalog is not
 * installed. No data loss.
 */
export const CATALOG_PROMPT_DISMISSED_KEY_PREFIX =
  "tcger:catalog-prompt-dismissed:";

/**
 * Build the dismissal key for one game at one catalog version.
 *
 * `version` is `undefined` before the manifest has loaded; the `"unknown"`
 * suffix is part of the released key format and must not change.
 */
export function catalogPromptDismissedKey(
  tcg: string,
  version?: number,
): string {
  return `${CATALOG_PROMPT_DISMISSED_KEY_PREFIX}${tcg}:v${version ?? "unknown"}`;
}

/**
 * Prefix for defensive copies of `tcg-demo-store` taken when a migration
 * cannot parse it: `tcg-demo-store.backup.<timestamp>` (§5 R1 — "never delete
 * data you failed to read").
 *
 * No writer exists yet; the prefix is registered now so that whichever stage
 * starts writing backups does not have to invent a name, and so a reset sweeps
 * them up.
 *
 * Cleared: an unreadable snapshot of a demo collection is discarded for good.
 */
export const DEMO_STORE_BACKUP_KEY_PREFIX = "tcg-demo-store.backup.";

/* ------------------------------------------------------------------ */
/*  IndexedDB — databases, stores, indexes                             */
/* ------------------------------------------------------------------ */

/**
 * Offline card catalogs. Up to ~20 MB for Magic alone.
 *
 * Owner: `src/lib/catalog/catalog-db.ts` (raw IndexedDB), installed through
 * `catalog-client.ts`, queried through `catalog-search.ts`.
 *
 * Cleared: every downloaded catalog is gone and has to be re-downloaded (a
 * multi-MB fetch per game). Demo mode reads the catalog too, so a cleared
 * catalog also empties demo search results until it is reinstalled.
 *
 * Schema is replaced wholesale per game and per pack version, so `DB_VERSION`
 * has never had to move off 1. The store and index shapes below must be
 * reproduced exactly by anything that re-declares this database (§5 R3):
 * compound `keyPath`s and compound indexes are where a hand-translated schema
 * most easily diverges.
 */
export const CATALOG_DB_NAME = "tcger-catalog";
/** IndexedDB store version of {@link CATALOG_DB_NAME}. */
export const CATALOG_DB_VERSION = 1;
/** Installed-pack metadata, `keyPath: "tcg"`. */
export const CATALOG_PACKS_STORE = "packs";
/** Catalog cards, `keyPath: ["tcg", "id"]`. */
export const CATALOG_CARDS_STORE = "cards";
/** Index on `"tcg"` (non-unique). */
export const CATALOG_CARDS_TCG_INDEX = "by-tcg";
/** Index on `["tcg", "setCode"]` (non-unique). */
export const CATALOG_CARDS_SET_INDEX = "by-tcg-set";

/**
 * Scanner artifacts: perceptual hash pages, the artwork fingerprint database
 * and the embedding index, keyed by game and index version.
 *
 * Owner: `src/components/scan/use-video-scan-data.ts` (raw IndexedDB).
 *
 * Cleared: the next scan session re-downloads and re-parses the hash pages,
 * artwork database and embedding index. Slow, not lossy — everything in here is
 * derived from server-side artifacts.
 */
export const SCAN_CACHE_DB_NAME = "tcger-scan-cache";
/** IndexedDB store version of {@link SCAN_CACHE_DB_NAME}. */
export const SCAN_CACHE_DB_VERSION = 2;
/** Hash entry pages, out-of-line keys. */
export const SCAN_CACHE_HASH_STORE = "hashEntries";
/** Parsed artwork fingerprint database, out-of-line keys. */
export const SCAN_CACHE_ARTWORK_STORE = "artworkDb";
/** Parsed embedding index, out-of-line keys. */
export const SCAN_CACHE_EMBEDDING_STORE = "embeddingIndex";

/**
 * Demo store database (plan §4 Stage 2, not created yet).
 *
 * Registered ahead of its owner so that the name is decided in one place and so
 * `clearAllLocalData()` covers it the moment it exists. `src/lib/storage/demo-db.ts`
 * must import this constant instead of naming its Dexie database inline.
 *
 * The Dexie *store* version lives with the schema declaration in that module;
 * the separate application-level row-shape version is `DEMO_SCHEMA_VERSION` in
 * `src/lib/storage/demo-persistence.ts` (currently 1). They are deliberately
 * different things.
 *
 * Cleared: same consequence as {@link DEMO_STORE_STORAGE_KEY} — the demo
 * collection is gone and re-seeds from fixtures.
 */
export const DEMO_DB_NAME = "tcger-demo";

/**
 * Tesseract.js OCR language data (`eng.traineddata`, a few MB), written by
 * `idb-keyval` inside the library's worker: database `keyval-store`, store
 * `keyval`.
 *
 * Owner: third party. Reached from `src/lib/scan/collector-ocr.ts`, which
 * lazily imports `tesseract.js` for collector-number OCR. The name is fixed by
 * the library, not by us, and is not listed in the plan.
 *
 * Cleared: the next OCR scan re-downloads the language data. Slow, not lossy.
 */
export const TESSERACT_CACHE_DB_NAME = "keyval-store";

/* ------------------------------------------------------------------ */
/*  The registry                                                       */
/* ------------------------------------------------------------------ */

/** Every fixed localStorage key TCGer's origin owns. */
export const LOCAL_STORAGE_KEYS = [
  DEMO_MODE_STORAGE_KEY,
  AUTH_STORE_STORAGE_KEY,
  DEMO_STORE_STORAGE_KEY,
  THEME_STORAGE_KEY,
] as const;

/**
 * localStorage key families whose suffix is unbounded, so they can only be
 * matched by prefix.
 */
export const LOCAL_STORAGE_KEY_PREFIXES = [
  CATALOG_PROMPT_DISMISSED_KEY_PREFIX,
  DEMO_STORE_BACKUP_KEY_PREFIX,
] as const;

/** Every IndexedDB database on TCGer's origin, including the third-party one. */
export const INDEXED_DB_NAMES = [
  CATALOG_DB_NAME,
  SCAN_CACHE_DB_NAME,
  DEMO_DB_NAME,
  TESSERACT_CACHE_DB_NAME,
] as const;

/* ------------------------------------------------------------------ */
/*  Not in the registry (documented so nothing is inferred from silence)*/
/* ------------------------------------------------------------------ */

/**
 * Service worker cache-storage version, mirrored from `public/sw.js`. The
 * derived buckets are `${version}-static`, `-scan`, `-catalog` and `-model`.
 *
 * `sw.js` is plain JavaScript served as a static asset and cannot import this
 * module, so the value is duplicated there — keep the two in step by hand.
 *
 * **Not deleted by `clearAllLocalData()`.** These caches hold HTTP responses,
 * not application state: dropping them costs a re-download of the app shell,
 * the scanner model and the catalog packs while fixing nothing. `removeCatalog`
 * in `catalog-client.ts` already evicts the specific catalog entries it
 * invalidates.
 */
export const SERVICE_WORKER_CACHE_VERSION = "tcger-v2";

/*
 * Also deliberately out of scope:
 *
 *  - **Cookies**, including the Better Auth session cookie. Clearing local data
 *    must not silently sign a visitor out of a live server session; sign-out is
 *    its own flow.
 *  - **`@huggingface/transformers` model cache.** The library is a lazy
 *    dynamic import in `src/lib/scan/embedding-matcher.ts` and is not installed
 *    in this tree, so its storage was not verified from source; upstream
 *    documents Cache Storage, not IndexedDB. Revisit if that changes.
 *  - **sessionStorage.** No usage anywhere in the frontend.
 */

/* ------------------------------------------------------------------ */
/*  clearAllLocalData                                                  */
/* ------------------------------------------------------------------ */

/**
 * Outcome of {@link clearAllLocalData}. Entries are labelled
 * `"localStorage:<key>"` or `"indexedDB:<name>"`; the bare label
 * `"localStorage"` means the whole API was unreachable, so nothing could even
 * be enumerated.
 */
export interface ClearAllLocalDataResult {
  /** Everything that existed and was removed. */
  cleared: string[];
  /** Everything that existed and could not be removed. */
  failed: string[];
}

/**
 * How long to wait for a single `deleteDatabase` before giving up on it.
 *
 * A delete blocks while any connection to that database is still open — another
 * tab, or a module in this tab that has not closed its handle. The request stays
 * pending indefinitely in that case, so an unbounded await would hang the reset.
 */
export const IDB_DELETE_TIMEOUT_MS = 5_000;

function collectLocalStorageKeys(): string[] | null {
  try {
    const store = window.localStorage;
    const keys: string[] = [];
    // Snapshot before removing anything: removal reindexes the store, so
    // enumerating and deleting in the same pass skips entries.
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key !== null) keys.push(key);
    }
    return keys;
  } catch {
    // Private browsing and some embedded webviews throw on access rather than
    // exposing an empty store.
    return null;
  }
}

function clearLocalStorage(result: ClearAllLocalDataResult): void {
  const present = collectLocalStorageKeys();
  if (present === null) {
    result.failed.push("localStorage");
    return;
  }

  const fixed = new Set<string>(LOCAL_STORAGE_KEYS);
  const targets = present.filter(
    (key) =>
      fixed.has(key) ||
      LOCAL_STORAGE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );

  for (const key of targets) {
    try {
      window.localStorage.removeItem(key);
      result.cleared.push(`localStorage:${key}`);
    } catch {
      result.failed.push(`localStorage:${key}`);
    }
  }
}

function getIndexedDbFactory(): IDBFactory | null {
  try {
    return typeof indexedDB === "undefined" ? null : indexedDB;
  } catch {
    // Sandboxed iframes can throw on the property access itself.
    return null;
  }
}

/**
 * Names of the databases that actually exist, or `null` when the browser does
 * not support enumeration (older Safari, older Firefox). `null` means "attempt
 * every registered name" — deleting a database that was never created succeeds
 * and is a no-op.
 */
async function listExistingDatabases(
  factory: IDBFactory,
): Promise<Set<string> | null> {
  if (typeof factory.databases !== "function") return null;
  try {
    const infos = await factory.databases();
    return new Set(
      infos
        .map((info) => info.name)
        .filter((name): name is string => typeof name === "string"),
    );
  } catch {
    return null;
  }
}

/** Resolves `true` when the database is gone, `false` on error, block or timeout. */
function deleteIndexedDb(factory: IDBFactory, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.deleteDatabase(name);
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (deleted: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(deleted);
    };

    // Armed unconditionally: it bounds `onblocked` (another connection is open
    // and may never close) and any state where no event fires at all.
    const timer = setTimeout(() => finish(false), IDB_DELETE_TIMEOUT_MS);

    request.onsuccess = () => finish(true);
    request.onerror = () => finish(false);
    request.onblocked = () => {
      // Leave the request pending — the browser completes it once the blocking
      // connection closes — but stop waiting on it here.
    };
  });
}

async function clearIndexedDb(result: ClearAllLocalDataResult): Promise<void> {
  const factory = getIndexedDbFactory();
  // No IndexedDB means no TCGer database can exist, so there is nothing to
  // report as failed.
  if (!factory) return;

  const existing = await listExistingDatabases(factory);
  const targets = INDEXED_DB_NAMES.filter(
    (name) => existing === null || existing.has(name),
  );

  const outcomes = await Promise.all(
    targets.map(async (name) => ({
      name,
      deleted: await deleteIndexedDb(factory, name),
    })),
  );

  for (const { name, deleted } of outcomes) {
    (deleted ? result.cleared : result.failed).push(`indexedDB:${name}`);
  }
}

/**
 * Remove every localStorage key and delete every IndexedDB database in this
 * registry — the "reset my local data" escape hatch for a failed migration or a
 * corrupt store (plan §4 Stage 0, §5).
 *
 * Semantics:
 *
 *  - **Never throws and never rejects.** Individual failures — private
 *    browsing, a blocked delete, a quota-locked store — land in `failed`.
 *  - **Reports only what existed.** A key that was not set, or a database that
 *    was never created, appears in neither array. Where the browser cannot
 *    enumerate databases (`indexedDB.databases()` unsupported), every
 *    registered name is attempted, and a no-op delete counts as `cleared`.
 *  - **Bounded.** Each database delete gives up after
 *    {@link IDB_DELETE_TIMEOUT_MS} rather than waiting forever on an open
 *    connection in another tab; the browser may still finish that delete later,
 *    so a `failed` IndexedDB entry means "not confirmed", not "still present".
 *  - **Server-safe.** Outside the browser it resolves with two empty arrays.
 *  - **Does not touch** service worker caches or cookies — see "Not in the
 *    registry" above.
 *
 * In-memory state outlives this call: zustand stores, the cached catalog
 * database handle and the demo fetch interceptor all keep running against data
 * that no longer exists on disk. Callers should reload the page afterwards.
 */
export async function clearAllLocalData(): Promise<ClearAllLocalDataResult> {
  const result: ClearAllLocalDataResult = { cleared: [], failed: [] };
  if (typeof window === "undefined") return result;

  clearLocalStorage(result);
  await clearIndexedDb(result);

  return result;
}
