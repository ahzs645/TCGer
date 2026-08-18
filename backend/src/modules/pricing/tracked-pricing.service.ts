import type {
  PriceSource,
  TrackedPriceItem,
  TrackedPriceResult,
  TrackedPricesResponse,
} from '@tcg/api-types';
import { env } from '../../config/env';
import { fetchLiveCardPrices } from './live-pricing.service';
import type { LivePriceResult } from './pricing.types';

type PriceFetcher = (
  tcg: string,
  externalId: string,
  finishCode?: string,
  source?: PriceSource,
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
}

export function trackedPriceKey(item: TrackedPriceItem, source: PriceSource = 'automatic'): string {
  const itemKey = `${item.tcg.trim().toLowerCase()}:${item.externalId.trim()}:${item.finishCode?.trim().toLowerCase() ?? ''}`;
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
        const [quote] = await fetcher(item.tcg, item.externalId, item.finishCode, source);
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
) {
  if (env.BACKEND_MODE === 'convex') {
    return fetchLiveCardPrices(tcg, externalId, finishCode, source);
  }
  return (await import('./pricing.service')).fetchCardPrices(tcg, externalId, finishCode, source);
}

export const trackedPricingService = createTrackedPricingService(fetchTrackedPrice, {
  ttlMs: env.PRICE_REFRESH_INTERVAL_MS,
  forceCooldownMs: env.PRICE_FORCE_REFRESH_COOLDOWN_MS,
});
