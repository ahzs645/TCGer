import { useCallback, useRef } from "react";

import type { Table } from "dexie";

import {
  getCardScanHashesPageApi,
  type CardScanHashEntry,
} from "@/lib/api/scan";
import { API_BASE_URL } from "@/lib/api/base-url";
import {
  parseArtworkDatabase,
  type ArtworkFingerprintEntry,
} from "@/lib/scan/browser-video-matcher";
import {
  embeddingModelKey,
  parseEmbeddingIndex,
  type EmbeddingIndex,
} from "@/lib/scan/embedding-matcher";
import type { SupportedTcg } from "@/lib/scan/scan-types";
import { scanIndexAssetUrl } from "@/lib/scan/scan-index-assets";
import {
  SCAN_CACHE_ARTWORK_STORE as ARTWORK_STORE,
  SCAN_CACHE_EMBEDDING_STORE as EMBEDDING_STORE,
  SCAN_CACHE_HASH_STORE as HASH_STORE,
  SCAN_CACHE_DB_NAME as IDB_NAME,
  SCAN_CACHE_DB_VERSION,
} from "@/lib/storage/keys";

import { HASH_PAGE_SIZE, type ScanFilter } from "./video-scan-types";

/* ------------------------------------------------------------------ */
/*  Scan cache database (Dexie)                                        */
/* ------------------------------------------------------------------ */

/**
 * `tcger-scan-cache` — hash pages, the artwork fingerprint database and the
 * embedding index. Stage 3 of `docs/data-layer-dexie-convex-plan.md` §4 moves
 * this off raw `indexedDB` and onto Dexie, following the house pattern in
 * `src/lib/storage/demo-db.ts`: cached dynamic import, explicit immutable
 * version blocks, degrade to "no cache" instead of throwing at the caller.
 *
 * Everything in this database is *derived* — hash pages come from the API,
 * the artwork database from `/cards/scan/artwork-fingerprints`, the embedding
 * index from a static `/scan-index` artifact — so a miss costs a re-download,
 * never data. That is the invariant the rest of this module protects: no
 * failure path here is allowed to reach the scanner. It either serves a cache
 * hit or reports a miss, and a miss re-fetches.
 *
 * ## Why the schema below cannot restructure an installed database (§5 R3)
 *
 * The released schema was created by hand:
 *
 * ```js
 * indexedDB.open("tcger-scan-cache", 2).onupgradeneeded = () => {
 *   if (!db.objectStoreNames.contains("hashEntries"))   db.createObjectStore("hashEntries");
 *   if (!db.objectStoreNames.contains("artworkDb"))     db.createObjectStore("artworkDb");
 *   if (!db.objectStoreNames.contains("embeddingIndex"))db.createObjectStore("embeddingIndex");
 * };
 * ```
 *
 * — three stores with **out-of-line keys**: no `keyPath`, no `autoIncrement`,
 * no indexes. Keys are passed at write time (`store.put(value, key)`).
 *
 * Dexie spells an out-of-line primary key as the empty string, `""`. That is
 * not folklore: `""` parses to a primary-key spec with `keyPath: null` and
 * `auto: false` and zero secondary indexes, and Dexie's `createTable()` turns
 * that into `createObjectStore(name, { autoIncrement: false })` — byte for byte
 * what `db.createObjectStore(name)` above produces.
 *
 * Dexie decides what to change by diffing the schema declared here against the
 * schema it *reads back* from the database that is actually installed, not
 * against a remembered history. Against an installed v2 database that diff is
 * empty in every field (`add`, `del`, `change`, `recreate`), so the upgrade
 * transaction does nothing at all and every cached page survives. Against a
 * database that is missing a store — the shape a pre-v2 install would have —
 * the diff contains only that store as an addition, which is exactly what the
 * `if (!contains(...))` guards above did.
 *
 * Two consequences of Dexie's model that are easy to be surprised by:
 *
 *  - **Dexie opens the native database at `version * 10`.** Declaring
 *    `version(2)` opens `tcger-scan-cache` at native version 20, so an
 *    installed v2 database *does* run one (empty) upgrade transaction on first
 *    load. That is the intended one-way step; the plan calls for the declared
 *    version to end up above the raw one.
 *  - **A store that is not declared here is dropped**, because Dexie's upgrade
 *    deletes object stores absent from the declared schema. Only the three
 *    names below have ever been created by this repository — verified across
 *    every commit in the history, all of which open at version 2 with these
 *    three stores — so there is nothing else to lose. (v1 predates the repo and
 *    left no trace; it can only have been a subset of these three, which the
 *    diff handles.)
 *
 * **Never edit a released `version(n)` block.** To change the schema, add a
 * `version(3)` below and leave 1 and 2 exactly as they are.
 */
const SCAN_CACHE_STORES = {
  // Out-of-line keys: `""` is Dexie's spelling for "no keyPath".
  [HASH_STORE]: "",
  [ARTWORK_STORE]: "",
  [EMBEDDING_STORE]: "",
} as const;

/**
 * The last raw (hand-written) schema version, pinned to the registry.
 *
 * The annotation is the point: if `SCAN_CACHE_DB_VERSION` ever moves, this line
 * stops compiling, and the fix is to **add** a `version(3)` block below rather
 * than to renumber the released ones.
 */
const LAST_RAW_VERSION: 2 = SCAN_CACHE_DB_VERSION;

/** Row shape stored in `embeddingIndex`, keyed by tcg code. */
interface CachedEmbeddingIndex {
  version: number;
  /** Artifact filename; absent on rows cached before encoder variants. */
  file?: string;
  index: EmbeddingIndex;
}

/**
 * How long a single open may take before the cache is written off for this
 * session.
 *
 * This is load-bearing, not belt-and-braces. Dexie opens at native version 20
 * where the installed database is at 2, so the very first load after this ships
 * runs an IndexedDB *upgrade* — and an upgrade blocks indefinitely while any
 * other connection to the database is still open. A second tab running the
 * previous build holds exactly such a connection and never closes it (the raw
 * code registered no `versionchange` handler). Without this bound, `open()`
 * would simply never settle and the scanner would sit at "loading" forever.
 * With it, the scan falls back to downloading, and the browser finishes the
 * upgrade on its own once the other tab goes away.
 */
const OPEN_TIMEOUT_MS = 5_000;

async function loadScanCacheDatabase() {
  const { default: Dexie } = await import("dexie");

  class ScanCacheDatabase extends Dexie {
    constructor() {
      super(IDB_NAME);
      // v1 and v2 — released. Do not edit; add a new version block instead.
      this.version(1).stores(SCAN_CACHE_STORES);
      this.version(LAST_RAW_VERSION).stores(SCAN_CACHE_STORES);
    }

    /** Hash pages, keyed by `ScanFilter`. */
    get hashes(): Table<CardScanHashEntry[], string> {
      return this.table<CardScanHashEntry[], string>(HASH_STORE);
    }

    /** Artwork fingerprints, keyed by `ScanFilter`. */
    get artwork(): Table<ArtworkFingerprintEntry[], string> {
      return this.table<ArtworkFingerprintEntry[], string>(ARTWORK_STORE);
    }

    /** Versioned embedding indexes, keyed by concrete tcg code. */
    get embeddings(): Table<CachedEmbeddingIndex, string> {
      return this.table<CachedEmbeddingIndex, string>(EMBEDDING_STORE);
    }
  }

  return ScanCacheDatabase;
}

type ScanCacheDatabaseCtor = Awaited<ReturnType<typeof loadScanCacheDatabase>>;
type ScanCacheDatabase = InstanceType<ScanCacheDatabaseCtor>;

let scanCacheCtorPromise: Promise<ScanCacheDatabaseCtor> | null = null;

function scanCacheDatabaseCtor(): Promise<ScanCacheDatabaseCtor> {
  // Cached so the class — and therefore the schema declaration — is created
  // once per session.
  if (!scanCacheCtorPromise) {
    scanCacheCtorPromise = loadScanCacheDatabase().catch((error: unknown) => {
      // A *failure* is not cached: a chunk that failed to load once — flaky
      // network, or a deploy swapping assets out from under an open tab — can
      // succeed on the next attempt, and caching the rejection would condemn
      // the rest of the session to uncached scans for a transient error.
      scanCacheCtorPromise = null;
      throw error;
    });
  }
  return scanCacheCtorPromise;
}

const warned = new Set<string>();

/**
 * Storage problems are diagnostics, not events — the same broken browser hits
 * the same path on every scan. One line per distinct cause, per session.
 */
function warnOnce(tag: string, message: string, error?: unknown): void {
  if (warned.has(tag)) return;
  warned.add(tag);
  if (error === undefined) console.warn(`[tcger-scan-cache] ${message}`);
  else console.warn(`[tcger-scan-cache] ${message}`, error);
}

/**
 * Whether IndexedDB can even be touched here.
 *
 * Accessing `window.indexedDB` is itself throwing code in some configurations
 * (sandboxed iframes without `allow-same-origin`, storage blocked by policy),
 * so the probe is wrapped. This is a *capability* check only — an `indexedDB`
 * that exists but refuses to open is handled by `openScanCache()`, because that
 * failure is only observable asynchronously.
 *
 * Deliberately duplicated from `demo-db.ts` rather than imported: that module
 * statically pulls in the whole demo-persistence graph, and the scanner ships
 * in the authenticated app (§5 R6).
 */
function isIndexedDbUsable(): boolean {
  if (typeof window === "undefined") return false; // SSR / static prerender
  try {
    return Boolean(window.indexedDB);
  } catch {
    return false;
  }
}

/** Set once the cache has been written off; from then on every scan re-fetches. */
let scanCacheAbandoned = false;
let scanCachePromise: Promise<ScanCacheDatabase | null> | null = null;

function abandonScanCache(tag: string, message: string, error?: unknown): void {
  scanCacheAbandoned = true;
  warnOnce(tag, message, error);
}

async function openScanCacheNow(): Promise<ScanCacheDatabase | null> {
  if (!isIndexedDbUsable()) {
    // Not `abandonScanCache`: there is nothing to abandon, and the memoised
    // promise below already stops this from being probed again.
    warnOnce(
      "indexeddb-unavailable",
      "IndexedDB is not available in this browser; scan data will be downloaded every session.",
    );
    return null;
  }
  const DatabaseCtor = await scanCacheDatabaseCtor();
  const db = new DatabaseCtor();
  // Explicit rather than implicit-on-first-query, so an unopenable database
  // fails here — in the one place that knows how to degrade — instead of
  // somewhere inside a read.
  await db.open();
  return db;
}

/**
 * The shared handle, or `null` when there is no usable cache.
 *
 * **Never rejects.** Every caller treats `null` as "cache miss", which is
 * already a supported outcome, so an unavailable database costs a re-download
 * and nothing else.
 *
 * One connection per session, unlike the raw code this replaces, which opened a
 * fresh one on every call and closed none.
 */
function openScanCache(): Promise<ScanCacheDatabase | null> {
  if (scanCacheAbandoned) return Promise.resolve(null);
  if (scanCachePromise) return scanCachePromise;

  scanCachePromise = new Promise<ScanCacheDatabase | null>((resolve) => {
    let settled = false;
    const finish = (db: ScanCacheDatabase | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(db);
    };

    const timer = setTimeout(() => {
      abandonScanCache(
        "open-timeout",
        `Opening the scan cache took longer than ${OPEN_TIMEOUT_MS} ms (another tab may be holding the old version open); scanning without it for this session. Nothing stored has been touched.`,
      );
      finish(null);
      // The open request is deliberately left pending rather than cancelled:
      // the browser completes the upgrade once the blocking connection closes,
      // so the next page load finds a ready database.
    }, OPEN_TIMEOUT_MS);

    openScanCacheNow().then(
      (db) => {
        if (db && scanCacheAbandoned) {
          // Timed out earlier and finished afterwards: no one will use this
          // handle, so do not hold a connection open for the rest of the
          // session.
          try {
            db.close();
          } catch {
            /* closing an already-broken handle is best effort */
          }
          finish(null);
          return;
        }
        finish(db);
      },
      (error: unknown) => {
        abandonScanCache(
          "open-failed",
          "The scan cache is unavailable; scan data will be downloaded instead of read from disk.",
          error,
        );
        finish(null);
      },
    );
  });

  return scanCachePromise;
}

/**
 * Read through the cache, turning any failure into a miss.
 *
 * A rejected read used to escape all the way to `video-scan-lab.tsx`, where it
 * became `setError(...)` and aborted the scan — a corrupt or evicted cache
 * broke the scanner instead of costing it a download. It now degrades.
 */
async function readCached<T>(
  read: () => Promise<T | undefined>,
  tag: string,
  what: string,
): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    warnOnce(tag, `Could not read the cached ${what}; re-downloading.`, error);
    return undefined;
  }
}

/**
 * Write through the cache, fire and forget.
 *
 * Deliberately not awaited: these values are multi-megabyte, the caller already
 * holds them in memory, and blocking a scan on a write that only pays off next
 * session would be a regression. A failure — a full quota being the likely one
 * — costs a re-download later and nothing now.
 */
function writeCached(
  write: () => Promise<unknown>,
  tag: string,
  what: string,
): void {
  void write().catch((error: unknown) => {
    warnOnce(
      tag,
      `Could not cache the ${what} (storage may be full); it will be downloaded again next time.`,
      error,
    );
  });
}

// ---------- hook ----------

export interface VideoScanDataCallbacks {
  onHashStatus: (status: string) => void;
  onHashCount: (count: number) => void;
  onLoadingChange: (loading: boolean) => void;
}

/**
 * Hook that manages hash index + artwork fingerprint loading for the video scanner.
 * Data is cached in IndexedDB so subsequent loads are instant.
 */
export function useVideoScanData(
  token: string | null,
  callbacks: VideoScanDataCallbacks,
) {
  const hashCacheRef = useRef(new Map<string, CardScanHashEntry[]>());
  const artworkDbRef = useRef<ArtworkFingerprintEntry[] | null>(null);
  const embeddingIndexesRef = useRef(new Map<SupportedTcg, EmbeddingIndex>());
  const embeddingIndexFilesRef = useRef(new Map<SupportedTcg, string>());

  /**
   * Load the client-side embedding index for the given filter from a static,
   * versioned artifact. Version-aware: fetches the tiny scan-index manifest
   * (network-first), serves the IndexedDB-cached index when its version matches,
   * re-downloads only when the version changed, and falls back to the cache when
   * offline. No server is required in the recognition path.
   */
  const ensureEmbeddingIndexes = useCallback(
    async (requestedFilter: ScanFilter): Promise<EmbeddingIndex[]> => {
      const db = await openScanCache();
      const gameOrder: SupportedTcg[] = ["pokemon", "magic", "yugioh"];
      type ManifestEntry = { file: string; version: number; total: number };
      let manifestEntries: Partial<Record<SupportedTcg, ManifestEntry>> = {};

      try {
        const res = await fetch(scanIndexAssetUrl("manifest.json"), {
          cache: "no-cache",
        });
        if (res.ok) {
          const manifest = (await res.json()) as {
            indexes?: Partial<Record<SupportedTcg, ManifestEntry>>;
          };
          manifestEntries = manifest.indexes ?? {};
        }
      } catch {
        // Offline: each concrete shard can still fall back to IndexedDB.
      }

      const games: SupportedTcg[] =
        requestedFilter === "all" ? gameOrder : [requestedFilter];

      const loadShard = async (tcg: SupportedTcg) => {
        const entry = manifestEntries[tcg] ?? null;
        const inMemory = embeddingIndexesRef.current.get(tcg);
        if (
          inMemory &&
          (!entry || embeddingIndexFilesRef.current.get(tcg) === entry.file)
        ) {
          return inMemory;
        }

        if (db) {
          const cached = await readCached(
            () => db.embeddings.get(tcg),
            `embedding-read-failed-${tcg}`,
            `${tcg} embedding index`,
          );
          if (cached?.index?.total) {
            const fresh =
              !entry ||
              (cached.version === entry.version &&
                (!cached.file || cached.file === entry.file));
            if (fresh) {
              embeddingIndexesRef.current.set(tcg, cached.index);
              const artifactFile = cached.file ?? entry?.file;
              if (artifactFile)
                embeddingIndexFilesRef.current.set(tcg, artifactFile);
              return cached.index;
            }
          }
        }

        if (!entry) return null;

        try {
          const res = await fetch(scanIndexAssetUrl(entry.file), {
            cache: "force-cache",
          });
          if (!res.ok) return null;
          const artifact = await res.json();
          const index = parseEmbeddingIndex(artifact, tcg);
          embeddingIndexesRef.current.set(tcg, index);
          embeddingIndexFilesRef.current.set(tcg, entry.file);
          if (db) {
            const row = { version: entry.version, file: entry.file, index };
            writeCached(
              () => db.embeddings.put(row, tcg),
              `embedding-write-failed-${tcg}`,
              `${tcg} embedding index`,
            );
          }
          return index;
        } catch {
          return null;
        }
      };

      callbacks.onHashStatus(
        requestedFilter === "all"
          ? "Loading compatible game shards…"
          : `Loading ${requestedFilter} embedding index…`,
      );
      const loaded = (await Promise.all(games.map(loadShard))).filter(
        (index): index is EmbeddingIndex => index !== null,
      );
      if (loaded.length === 0) {
        callbacks.onHashStatus("Embedding index unavailable.");
        return [];
      }

      // Automatic mode can embed once only when shards use the same universal
      // model contract. Prefer the contract represented by the most games;
      // ties follow the stable game order above.
      const groups = new Map<string, EmbeddingIndex[]>();
      for (const index of loaded) {
        const key = embeddingModelKey(index);
        groups.set(key, [...(groups.get(key) ?? []), index]);
      }
      const compatible = [...groups.values()].sort(
        (left, right) => right.length - left.length,
      )[0]!;
      const excluded = loaded.length - compatible.length;
      const total = compatible.reduce((sum, index) => sum + index.total, 0);
      const gamesLabel = compatible.map((index) => index.tcg).join(", ");
      callbacks.onHashStatus(
        `Ready: ${total.toLocaleString()} embeddings across ${gamesLabel}` +
          (excluded > 0
            ? ` (${excluded} incompatible model shard${excluded === 1 ? "" : "s"} skipped).`
            : "."),
      );
      return compatible;
    },
    [callbacks],
  );

  const ensureHashIndex = useCallback(
    async (requestedFilter: ScanFilter): Promise<CardScanHashEntry[]> => {
      if (!token) {
        throw new Error(
          "Sign in is required before loading the scan hash index.",
        );
      }

      // 1. Check in-memory cache
      const cacheKey = requestedFilter;
      const memCached = hashCacheRef.current.get(cacheKey);
      if (memCached) {
        callbacks.onHashCount(memCached.length);
        callbacks.onHashStatus(
          `Loaded ${memCached.length.toLocaleString()} hashes (memory cache).`,
        );
        return memCached;
      }

      callbacks.onLoadingChange(true);

      try {
        // 2. Check IndexedDB cache. `null` when IndexedDB is unavailable —
        //    fall through to network.
        const db = await openScanCache();

        if (db) {
          const idbHashes = await readCached(
            () => db.hashes.get(cacheKey),
            "hash-read-failed",
            "hash index",
          );
          if (idbHashes && idbHashes.length > 0) {
            hashCacheRef.current.set(cacheKey, idbHashes);
            callbacks.onHashCount(idbHashes.length);
            callbacks.onHashStatus(
              `Loaded ${idbHashes.length.toLocaleString()} hashes (local cache).`,
            );

            // Also restore artwork DB from IndexedDB
            if (!artworkDbRef.current) {
              const idbArtwork = await readCached(
                () => db.artwork.get(cacheKey),
                "artwork-read-failed",
                "artwork fingerprints",
              );
              if (idbArtwork && idbArtwork.length > 0) {
                artworkDbRef.current = idbArtwork;
                callbacks.onHashStatus(
                  `Loaded ${idbHashes.length.toLocaleString()} hashes + ${idbArtwork.length.toLocaleString()} artwork fingerprints (local cache).`,
                );
              }
            }

            return idbHashes;
          }
        }

        // 3. Fetch from server
        callbacks.onHashStatus("Downloading hash index from server...");
        const entries: CardScanHashEntry[] = [];
        let page = 1;
        let totalPages = 1;
        let totalEntries = 0;

        while (page <= totalPages) {
          const response = await getCardScanHashesPageApi({
            token,
            tcg: requestedFilter,
            page,
            pageSize: HASH_PAGE_SIZE,
          });

          entries.push(...response.entries);
          totalPages = response.totalPages;
          totalEntries = response.total;
          callbacks.onHashCount(entries.length);
          callbacks.onHashStatus(
            `Downloading: ${entries.length.toLocaleString()} / ${totalEntries.toLocaleString()} hashes.`,
          );
          page += 1;
        }

        hashCacheRef.current.set(cacheKey, entries);

        // Save to IndexedDB for next time
        if (db) {
          writeCached(
            () => db.hashes.put(entries, cacheKey),
            "hash-write-failed",
            "hash index",
          );
        }

        // 4. Load artwork fingerprints
        if (!artworkDbRef.current) {
          callbacks.onHashStatus(
            `Loaded ${entries.length.toLocaleString()} hashes. Downloading artwork fingerprints...`,
          );
          try {
            const artworkRes = await fetch(
              `${API_BASE_URL}/cards/scan/artwork-fingerprints`,
              {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
              },
            );
            if (artworkRes.ok) {
              const artworkJson = await artworkRes.json();
              const tcgCode =
                requestedFilter === "all" ? "pokemon" : requestedFilter;
              artworkDbRef.current = parseArtworkDatabase(artworkJson, tcgCode);

              // Save artwork to IndexedDB
              if (db) {
                const artwork = artworkDbRef.current;
                writeCached(
                  () => db.artwork.put(artwork, cacheKey),
                  "artwork-write-failed",
                  "artwork fingerprints",
                );
              }
            }
          } catch {
            // Artwork DB is optional
          }
        }

        const artCount = artworkDbRef.current?.length ?? 0;
        callbacks.onHashStatus(
          artCount > 0
            ? `Ready: ${entries.length.toLocaleString()} hashes + ${artCount.toLocaleString()} artwork fingerprints (saved locally).`
            : `Ready: ${entries.length.toLocaleString()} hashes (saved locally).`,
        );

        return entries;
      } finally {
        callbacks.onLoadingChange(false);
      }
    },
    [token, callbacks],
  );

  return {
    ensureHashIndex,
    ensureEmbeddingIndexes,
    artworkDbRef,
    embeddingIndexesRef,
    clearCache: useCallback(async () => {
      hashCacheRef.current.clear();
      artworkDbRef.current = null;
      embeddingIndexesRef.current.clear();
      embeddingIndexFilesRef.current.clear();
      const db = await openScanCache();
      if (!db) return; // nothing persisted, nothing to clear
      try {
        // One transaction for all three stores, so a partial wipe cannot leave
        // hashes without their artwork. Unlike the raw code this replaces, the
        // returned promise now settles *after* the wipe has actually landed.
        await db.transaction(
          "rw",
          db.hashes,
          db.artwork,
          db.embeddings,
          async () => {
            await db.hashes.clear();
            await db.artwork.clear();
            await db.embeddings.clear();
          },
        );
      } catch (error) {
        warnOnce("clear-failed", "Could not clear the scan cache.", error);
      }
    }, []),
  };
}
