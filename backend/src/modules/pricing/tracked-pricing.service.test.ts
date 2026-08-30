import type { TrackedPriceItem } from '@tcg/api-types';
import { createTrackedPricingService, summarizePricingHealth } from './tracked-pricing.service';
import type { LivePriceResult } from './pricing.types';

describe('tracked pricing cache', () => {
  it('separates fresh, stale, missing, failed, and low-confidence quotes', () => {
    const now = Date.parse('2026-08-15T00:00:00.000Z');
    const health = summarizePricingHealth([
      { key: 'a', tcg: 'magic', externalId: 'a', price: 2, currency: 'USD', cached: false, updatedAt: '2026-08-14T00:00:00.000Z' },
      { key: 'b', tcg: 'magic', externalId: 'b', price: 3, currency: 'USD', cached: false, updatedAt: '2026-08-10T00:00:00.000Z' },
      { key: 'c', tcg: 'magic', externalId: 'c', cached: false },
      { key: 'd', tcg: 'magic', externalId: 'd', cached: false, error: 'provider failed' },
      { key: 'e', tcg: 'magic', externalId: 'e', price: 4, currency: 'USD', cached: false, updatedAt: '2026-08-14T00:00:00.000Z', provenance: { provider: 'test', retrievedAt: '2026-08-14T00:00:00.000Z', originalQuotes: [], match: { method: 'fuzzy', confidence: 0.5 } } },
    ], now);
    expect(health).toMatchObject({ status: 'unsafe', total: 5, fresh: 2, stale: 1, missing: 1, failed: 1, lowConfidence: 1, coverage: 40 });
  });

  it('deduplicates cards and reuses a fresh cached quote', async () => {
    let timestamp = Date.parse('2026-08-15T00:00:00.000Z');
    const fetcher = jest
      .fn()
      .mockResolvedValue([
        { source: 'test', price: 3.25, currency: 'USD', updatedAt: '2026-08-15T00:00:00.000Z' },
      ]);
    const service = createTrackedPricingService(fetcher, {
      ttlMs: 12 * 60 * 60 * 1000,
      forceCooldownMs: 5 * 60 * 1000,
      now: () => timestamp,
    });
    const item = { tcg: 'magic', externalId: 'abc' };

    const first = await service.getTrackedPrices([item, item]);
    timestamp += 60_000;
    const second = await service.getTrackedPrices([item]);

    expect(first.prices).toHaveLength(1);
    expect(first.prices[0]).toMatchObject({ price: 3.25, cached: false });
    expect(second.prices[0]).toMatchObject({ price: 3.25, cached: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('allows force refresh but applies the force cooldown', async () => {
    let timestamp = Date.parse('2026-08-15T00:00:00.000Z');
    const fetcher = jest
      .fn()
      .mockResolvedValue([
        { source: 'test', price: 4, currency: 'USD', updatedAt: '2026-08-15T00:00:00.000Z' },
      ]);
    const service = createTrackedPricingService(fetcher, {
      ttlMs: 12 * 60 * 60 * 1000,
      forceCooldownMs: 5 * 60 * 1000,
      now: () => timestamp,
    });
    const item = { tcg: 'magic', externalId: 'abc' };

    await service.getTrackedPrices([item]);
    timestamp += 60_000;
    expect((await service.getTrackedPrices([item], true)).prices[0].cached).toBe(false);
    timestamp += 60_000;
    expect((await service.getTrackedPrices([item], true)).prices[0].cached).toBe(true);
    timestamp += 5 * 60_000;
    expect((await service.getTrackedPrices([item], true)).prices[0].cached).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('keeps provider-specific cache entries isolated', async () => {
    const fetcher = jest.fn(async (_tcg, _externalId, _finish, source) => [
      {
        source,
        price: source === 'scryfall' ? 2 : 7,
        currency: 'USD',
        updatedAt: '2026-08-15T00:00:00.000Z',
      },
    ]);
    const service = createTrackedPricingService(fetcher, {
      ttlMs: 60_000,
      forceCooldownMs: 10_000,
    });
    const item = { tcg: 'magic', externalId: 'abc' };

    const scryfall = await service.getTrackedPrices([item], false, 'scryfall');
    const justTcg = await service.getTrackedPrices([item], false, 'justtcg');

    expect(scryfall.prices[0]).toMatchObject({ price: 2, source: 'scryfall' });
    expect(justTcg.prices[0]).toMatchObject({ price: 7, source: 'justtcg' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses one JustTCG batch fetch for a mixed-game collection', async () => {
    const fetcher = jest.fn().mockResolvedValue([]);
    const batchFetcher = jest.fn(async (items: TrackedPriceItem[]) =>
      new Map<string, LivePriceResult>(
        items.map((item) => [
          `${item.tcg}:${item.externalId}:${item.finishCode ?? ''}:${item.condition ?? ''}:${item.language ?? ''}`,
          {
            source: 'justtcg',
            price: item.tcg === 'magic' ? 5.5 : 7.25,
            currency: 'USD',
            updatedAt: '2026-08-20T00:00:00.000Z',
          },
        ]),
      ),
    );
    const service = createTrackedPricingService(fetcher, {
      ttlMs: 60_000,
      forceCooldownMs: 10_000,
      justTcgBatchFetcher: batchFetcher,
    });

    const response = await service.getTrackedPrices(
      [
        { tcg: 'magic', externalId: 'magic-card', condition: 'Near Mint', language: 'English' },
        { tcg: 'pokemon', externalId: 'pokemon-card', condition: 'Near Mint', language: 'Japanese' },
      ],
      false,
      'justtcg',
    );

    expect(batchFetcher).toHaveBeenCalledTimes(1);
    expect(batchFetcher).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ tcg: 'magic' }),
      expect.objectContaining({ tcg: 'pokemon' }),
    ]));
    expect(fetcher).not.toHaveBeenCalled();
    expect(response.prices.map((price) => price.price)).toEqual([5.5, 7.25]);
  });
});
