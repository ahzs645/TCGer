import { createTrackedPricingService } from './tracked-pricing.service';

describe('tracked pricing cache', () => {
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
});
