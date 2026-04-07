import { useCallback, useRef } from "react";

import {
  getCardScanHashesPageApi,
  type CardScanHashEntry,
} from "@/lib/api/scan";
import { API_BASE_URL } from "@/lib/api/base-url";
import {
  parseArtworkDatabase,
  type ArtworkFingerprintEntry,
} from "@/lib/scan/browser-video-matcher";

import { HASH_PAGE_SIZE, type ScanFilter } from "./video-scan-types";

// ---------- IndexedDB helpers ----------

const IDB_NAME = "tcger-scan-cache";
const IDB_VERSION = 1;
const HASH_STORE = "hashEntries";
const ARTWORK_STORE = "artworkDb";

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HASH_STORE)) {
        db.createObjectStore(HASH_STORE);
      }
      if (!db.objectStoreNames.contains(ARTWORK_STORE)) {
        db.createObjectStore(ARTWORK_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
        // 2. Check IndexedDB cache
        let db: IDBDatabase | null = null;
        try {
          db = await openCache();
        } catch {
          // IndexedDB unavailable — fall through to network
        }

        if (db) {
          const idbHashes = await idbGet<CardScanHashEntry[]>(
            db,
            HASH_STORE,
            cacheKey,
          );
          if (idbHashes && idbHashes.length > 0) {
            hashCacheRef.current.set(cacheKey, idbHashes);
            callbacks.onHashCount(idbHashes.length);
            callbacks.onHashStatus(
              `Loaded ${idbHashes.length.toLocaleString()} hashes (local cache).`,
            );

            // Also restore artwork DB from IndexedDB
            if (!artworkDbRef.current) {
              const idbArtwork = await idbGet<ArtworkFingerprintEntry[]>(
                db,
                ARTWORK_STORE,
                cacheKey,
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
          idbPut(db, HASH_STORE, cacheKey, entries).catch(() => {});
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
              artworkDbRef.current = parseArtworkDatabase(
                artworkJson,
                tcgCode,
              );

              // Save artwork to IndexedDB
              if (db) {
                idbPut(db, ARTWORK_STORE, cacheKey, artworkDbRef.current).catch(
                  () => {},
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
    artworkDbRef,
    clearCache: useCallback(async () => {
      hashCacheRef.current.clear();
      artworkDbRef.current = null;
      try {
        const db = await openCache();
        const tx = db.transaction([HASH_STORE, ARTWORK_STORE], "readwrite");
        tx.objectStore(HASH_STORE).clear();
        tx.objectStore(ARTWORK_STORE).clear();
      } catch {
        // IndexedDB unavailable
      }
    }, []),
  };
}
