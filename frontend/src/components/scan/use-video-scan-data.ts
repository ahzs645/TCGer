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

export interface VideoScanDataCallbacks {
  onHashStatus: (status: string) => void;
  onHashCount: (count: number) => void;
  onLoadingChange: (loading: boolean) => void;
}

/**
 * Hook that manages hash index + artwork fingerprint loading for the video scanner.
 *
 * Returns a function that loads (or returns cached) hash entries for a given filter,
 * and maintains the artwork DB ref.
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

      const cacheKey = requestedFilter;
      const cached = hashCacheRef.current.get(cacheKey);
      if (cached) {
        callbacks.onHashCount(cached.length);
        callbacks.onHashStatus(
          `Loaded ${cached.length.toLocaleString()} hashes (cached).`,
        );
        return cached;
      }

      callbacks.onLoadingChange(true);
      callbacks.onHashStatus("Loading hash index into the browser...");

      try {
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
            `Loading hash index: ${entries.length.toLocaleString()} / ${totalEntries.toLocaleString()} entries.`,
          );
          page += 1;
        }

        hashCacheRef.current.set(cacheKey, entries);

        // Load artwork fingerprint DB in background (non-blocking)
        if (!artworkDbRef.current) {
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
              callbacks.onHashStatus(
                `Loaded ${entries.length.toLocaleString()} hashes + ${artworkDbRef.current.length.toLocaleString()} artwork fingerprints.`,
              );
            }
          } catch {
            // Artwork DB is optional — fall back to pHash-only matching
          }
        }

        if (!artworkDbRef.current) {
          callbacks.onHashStatus(
            `Loaded ${entries.length.toLocaleString()} hashes.`,
          );
        }

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
    clearCache: useCallback(() => {
      hashCacheRef.current.clear();
      artworkDbRef.current = null;
    }, []),
  };
}
