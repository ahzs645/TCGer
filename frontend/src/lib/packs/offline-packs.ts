import type { PackOpeningPull } from "@tcg/pack-core/experience";

export const OFFLINE_PACK_STORAGE_KEY = "tcger.pack-offline-downloads.v1";
export const OFFLINE_PACK_CACHE_PREFIX = "tcger-v2-pack-";

export interface OfflinePackDefinition {
  id: string;
  name: string;
}

export const OFFLINE_PACK_DEFINITIONS: readonly OfflinePackDefinition[] = [
  { id: "base1", name: "Base Set" },
  { id: "me5", name: "Pitch Black" },
];

export interface OfflinePackRecord {
  setID: string;
  downloadedAt: string;
  cardCount: number;
  assetCount: number;
  byteCount: number;
}

export type OfflinePackRecords = Record<string, OfflinePackRecord>;

export function offlinePackDefinition(
  setID: string,
): OfflinePackDefinition | undefined {
  return OFFLINE_PACK_DEFINITIONS.find(
    (definition) =>
      definition.id.localeCompare(setID, undefined, { sensitivity: "base" }) ===
      0,
  );
}

export function offlinePackCacheName(setID: string): string {
  return `${OFFLINE_PACK_CACHE_PREFIX}${setID.toLocaleLowerCase()}`;
}

export function offlinePackAssetURLs(
  cards: readonly PackOpeningPull[],
): string[] {
  return [
    "/pack/manifest.json",
    "/pack/models/pack.obj",
    "/pack/card-backs/pokemon.png",
    ...new Set(cards.flatMap((card) => [card.imageUrl, card.imageUrlSmall])),
  ];
}

export function parseOfflinePackRecords(
  serialized: string | null,
): OfflinePackRecords {
  if (serialized === null) return {};
  try {
    const value: unknown = JSON.parse(serialized);
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return {};
    const records: OfflinePackRecords = {};
    for (const [key, candidate] of Object.entries(value)) {
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        !offlinePackDefinition(key)
      ) {
        continue;
      }
      const record = candidate as Partial<OfflinePackRecord>;
      if (
        record.setID !== key ||
        typeof record.downloadedAt !== "string" ||
        typeof record.cardCount !== "number" ||
        typeof record.assetCount !== "number" ||
        typeof record.byteCount !== "number"
      ) {
        continue;
      }
      records[key] = record as OfflinePackRecord;
    }
    return records;
  } catch {
    return {};
  }
}

export function serializeOfflinePackRecords(
  records: OfflinePackRecords,
): string {
  return JSON.stringify(records);
}

/**
 * Opening availability is a capability check, not a browser reachability
 * check. A durable download always wins even when the browser still reports an
 * unusable network route as online.
 */
export function canOpenPackSet(
  setID: string,
  networkUsable: boolean,
  records: OfflinePackRecords,
): boolean {
  return Boolean(records[setID]) || networkUsable;
}

export async function downloadOfflinePack(
  setID: string,
  cards: readonly PackOpeningPull[],
  onProgress: (value: number) => void,
): Promise<OfflinePackRecord> {
  if (!offlinePackDefinition(setID)) {
    throw new Error("This pack set is not available for offline download.");
  }
  if (!("caches" in globalThis)) {
    throw new Error("Offline downloads are not supported by this browser.");
  }

  const cacheName = offlinePackCacheName(setID);
  await caches.delete(cacheName);
  const cache = await caches.open(cacheName);
  const urls = offlinePackAssetURLs(cards);
  let completed = 0;
  let byteCount = 0;

  try {
    const pending = [...urls];
    const workers = Array.from(
      { length: Math.min(6, urls.length) },
      async () => {
        while (pending.length > 0) {
          const url = pending.shift();
          if (!url) return;
          const response = await fetch(url, { cache: "reload" });
          if (!response.ok) {
            throw new Error(
              `Could not download ${new URL(url, location.origin).pathname}.`,
            );
          }
          const size = Number(response.headers.get("content-length"));
          if (Number.isFinite(size)) byteCount += size;
          await cache.put(url, response.clone());
          completed += 1;
          onProgress(completed / urls.length);
        }
      },
    );
    await Promise.all(workers);
  } catch (error) {
    await caches.delete(cacheName);
    throw error;
  }

  return {
    setID,
    downloadedAt: new Date().toISOString(),
    cardCount: cards.length,
    assetCount: urls.length,
    byteCount,
  };
}

export async function removeOfflinePack(setID: string): Promise<void> {
  if (!("caches" in globalThis)) return;
  await caches.delete(offlinePackCacheName(setID));
}
