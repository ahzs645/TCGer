"use client";

import { useCallback, useEffect, useState } from "react";
import type { PackOpeningPull } from "@tcg/pack-core/experience";

import {
  downloadOfflinePack,
  canOpenPackSet,
  OFFLINE_PACK_DEFINITIONS,
  OFFLINE_PACK_STORAGE_KEY,
  offlinePackCacheName,
  parseOfflinePackRecords,
  removeOfflinePack,
  serializeOfflinePackRecords,
  type OfflinePackRecord,
  type OfflinePackRecords,
} from "./offline-packs";

export type OfflinePackStatus =
  | { kind: "notDownloaded" }
  | { kind: "downloading"; progress: number }
  | { kind: "downloaded"; record: OfflinePackRecord }
  | { kind: "failed"; message: string };

function persist(records: OfflinePackRecords) {
  try {
    window.localStorage.setItem(
      OFFLINE_PACK_STORAGE_KEY,
      serializeOfflinePackRecords(records),
    );
  } catch {
    // Cache Storage remains authoritative if private browsing blocks metadata.
  }
}

export function useOfflinePacks() {
  const [records, setRecords] = useState<OfflinePackRecords>({});
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const refreshOnline = () => setIsOnline(navigator.onLine);
    refreshOnline();
    window.addEventListener("online", refreshOnline);
    window.addEventListener("offline", refreshOnline);

    const restore = async () => {
      let restored: OfflinePackRecords = {};
      try {
        restored = parseOfflinePackRecords(
          window.localStorage.getItem(OFFLINE_PACK_STORAGE_KEY),
        );
      } catch {
        // Leave the list empty if storage is unavailable.
      }
      if ("caches" in globalThis) {
        const validated: OfflinePackRecords = {};
        for (const definition of OFFLINE_PACK_DEFINITIONS) {
          if (
            restored[definition.id] &&
            (await caches.has(offlinePackCacheName(definition.id)))
          ) {
            validated[definition.id] = restored[definition.id];
          }
        }
        restored = validated;
        persist(restored);
      }
      if (!cancelled) setRecords(restored);
    };
    void restore();

    return () => {
      cancelled = true;
      window.removeEventListener("online", refreshOnline);
      window.removeEventListener("offline", refreshOnline);
    };
  }, []);

  const statusFor = useCallback(
    (setID: string): OfflinePackStatus => {
      if (progress[setID] !== undefined) {
        return { kind: "downloading", progress: progress[setID] };
      }
      if (records[setID]) return { kind: "downloaded", record: records[setID] };
      if (errors[setID]) return { kind: "failed", message: errors[setID] };
      return { kind: "notDownloaded" };
    },
    [errors, progress, records],
  );

  const download = useCallback(
    async (setID: string, cards: readonly PackOpeningPull[]) => {
      setErrors((current) => {
        const next = { ...current };
        delete next[setID];
        return next;
      });
      setProgress((current) => ({ ...current, [setID]: 0 }));
      try {
        const record = await downloadOfflinePack(setID, cards, (value) =>
          setProgress((current) => ({ ...current, [setID]: value })),
        );
        setRecords((current) => {
          const next = { ...current, [setID]: record };
          persist(next);
          return next;
        });
      } catch (error) {
        setErrors((current) => ({
          ...current,
          [setID]: error instanceof Error ? error.message : "Download failed.",
        }));
      } finally {
        setProgress((current) => {
          const next = { ...current };
          delete next[setID];
          return next;
        });
      }
    },
    [],
  );

  const remove = useCallback(async (setID: string) => {
    await removeOfflinePack(setID);
    setRecords((current) => {
      const next = { ...current };
      delete next[setID];
      persist(next);
      return next;
    });
    setErrors((current) => {
      const next = { ...current };
      delete next[setID];
      return next;
    });
  }, []);

  const isDownloaded = useCallback(
    (setID: string) => Boolean(records[setID]),
    [records],
  );
  const canOpen = useCallback(
    (setID: string, networkUsable = isOnline) =>
      canOpenPackSet(setID, networkUsable, records),
    [isOnline, records],
  );

  return { isOnline, statusFor, isDownloaded, canOpen, download, remove };
}
