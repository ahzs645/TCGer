import type {
  PriceSource,
  TrackedPriceItem,
  TrackedPriceResult,
  TrackedPricesResponse,
} from '@tcg/api-types';
import { env } from '../../config/env';
import {
  fetchJustTcgTrackedPrices,
  fetchLiveCardPrices,
  justTcgBatchItemKey,
} from './live-pricing.service';
import type { LivePriceResult } from './pricing.types';

type PriceFetcher = (
  tcg: string,
  externalId: string,
  finishCode?: string,
  source?: PriceSource,
  item?: TrackedPriceItem,
) => Promise<LivePriceResult[]>;

interface CacheEntry {
  result: TrackedPriceResult;
  expiresAt: number;
  lastForcedAt?: number;
}

interface TrackedPricingOptions {
  ttlMs: number;
  forceCooldownMs: number;
  concurrency?: number;
  now?: () => number;
  justTcgBatchFetcher?: (
    items: TrackedPriceItem[],
  ) => Promise<Map<string, LivePriceResult>>;
}

export function trackedPriceKey(item: TrackedPriceItem, source: PriceSource = 'automatic'): string {
  const parts = [
    item.tcg.trim().toLowerCase(),
    item.externalId.trim().toLowerCase(),
    item.finishCode?.trim().toLowerCase() ?? '',
  ];
  if (item.condition || item.language) {
    parts.push(item.condition?.trim().toLowerCase() ?? '', item.language?.trim().toLowerCase() ?? '');
  }
  const itemKey = parts.join(':');
  return source === 'automatic' ? itemKey : `${source}:${itemKey}`;
}

export function createTrackedPricingService(fetcher: PriceFetcher, options: TrackedPricingOptions) {
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<TrackedPriceResult>>();
  const now = options.now ?? Date.now;
  const concurrency = Math.max(1, options.concurrency ?? 6);

  async function fetchOne(
    item: TrackedPriceItem,
    force: boolean,
    source: PriceSource,
  ): Promise<TrackedPriceResult> {
    const key = trackedPriceKey(item, source);
    const timestamp = now();
    const cached = cache.get(key);
    const canForce =
      force &&
      (!cached?.lastForcedAt || timestamp - cached.lastForcedAt >= options.forceCooldownMs);
    if (cached && cached.expiresAt > timestamp && !canForce) {
      return { ...cached.result, cached: true };
    }

    const running = inFlight.get(key);
    if (running) return running;

    const request = (async () => {
      try {
        const [quote] = await fetcher(item.tcg, item.externalId, item.finishCode, source, item);
        const result: TrackedPriceResult = quote
          ? {
              ...item,
              key,
              price: quote.price,
              currency: quote.currency,
              source: quote.source,
              updatedAt: quote.updatedAt,
              cached: false,
            }
          : { ...item, key, cached: false, error: 'No market price is available' };
        cache.set(key, {
          result,
          expiresAt: timestamp + (quote ? options.ttlMs : Math.min(options.ttlMs, 5 * 60 * 1000)),
          lastForcedAt: canForce ? timestamp : cached?.lastForcedAt,
        });
        return result;
      } catch (error) {
        const result: TrackedPriceResult = {
          ...item,
          key,
          cached: false,
          error: error instanceof Error ? error.message : 'Price lookup failed',
        };
        cache.set(key, {
          result,
          expiresAt: timestamp + Math.min(options.ttlMs, 5 * 60 * 1000),
          lastForcedAt: canForce ? timestamp : cached?.lastForcedAt,
        });
        return result;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, request);
    return request;
  }

  async function getTrackedPrices(
    items: TrackedPriceItem[],
    force = false,
    source: PriceSource = 'automatic',
  ): Promise<TrackedPricesResponse> {
    const unique = Array.from(
      new Map(items.map((item) => [trackedPriceKey(item, source), item])).values(),
    );
    if (source === 'justtcg' && options.justTcgBatchFetcher) {
      const results = new Map<string, TrackedPriceResult>();
      const pending: TrackedPriceItem[] = [];
      const forcedKeys = new Set<string>();
      for (const item of unique) {
        const key = trackedPriceKey(item, source);
        const timestamp = now();
        const cached = cache.get(key);
        const canForce =
          force &&
          (!cached?.lastForcedAt || timestamp - cached.lastForcedAt >= options.forceCooldownMs);
        if (cached && cached.expiresAt > timestamp && !canForce) {
          results.set(key, { ...cached.result, cached: true });
        } else {
          pending.push(item);
          if (canForce) forcedKeys.add(key);
        }
      }
      if (pending.length) {
        try {
          const quotes = await options.justTcgBatchFetcher(pending);
          const timestamp = now();
          for (const item of pending) {
            const key = trackedPriceKey(item, source);
            const quote = quotes.get(justTcgBatchItemKey(item));
            const result: TrackedPriceResult = quote
              ? {
                  ...item,
                  key,
                  price: quote.price,
                  currency: quote.currency,
                  source: quote.source,
                  updatedAt: quote.updatedAt,
                  cached: false,
                }
              : { ...item, key, cached: false, error: 'No market price is available' };
            cache.set(key, {
              result,
              expiresAt:
                timestamp + (quote ? options.ttlMs : Math.min(options.ttlMs, 5 * 60 * 1000)),
              lastForcedAt: forcedKeys.has(key) ? timestamp : cache.get(key)?.lastForcedAt,
            });
            results.set(key, result);
          }
        } catch (error) {
          for (const item of pending) {
            const key = trackedPriceKey(item, source);
            results.set(key, {
              ...item,
              key,
              cached: false,
              error: error instanceof Error ? error.message : 'Price lookup failed',
            });
          }
        }
      }
      const refreshedAt = new Date(now());
      return {
        prices: unique.map((item) => results.get(trackedPriceKey(item, source))!),
        refreshedAt: refreshedAt.toISOString(),
        refreshAfter: new Date(refreshedAt.getTime() + options.ttlMs).toISOString(),
      };
    }
    const prices: TrackedPriceResult[] = [];
    for (let index = 0; index < unique.length; index += concurrency) {
      prices.push(
        ...(await Promise.all(
          unique.slice(index, index + concurrency).map((item) => fetchOne(item, force, source)),
        )),
      );
    }
    const refreshedAt = new Date(now());
    return {
      prices,
      refreshedAt: refreshedAt.toISOString(),
      refreshAfter: new Date(refreshedAt.getTime() + options.ttlMs).toISOString(),
    };
  }

  return { getTrackedPrices };
}

async function fetchTrackedPrice(
  tcg: string,
  externalId: string,
  finishCode?: string,
  source: PriceSource = 'automatic',
  item?: TrackedPriceItem,
) {
  if (env.BACKEND_MODE === 'convex') {
    return fetchLiveCardPrices(tcg, externalId, finishCode, source, item);
  }
  return (await import('./pricing.service')).fetchCardPrices(tcg, externalId, finishCode, source, item);
}

export const trackedPricingService = createTrackedPricingService(fetchTrackedPrice, {
  ttlMs: env.PRICE_REFRESH_INTERVAL_MS,
  forceCooldownMs: env.PRICE_FORCE_REFRESH_COOLDOWN_MS,
  justTcgBatchFetcher: fetchJustTcgTrackedPrices,
});
